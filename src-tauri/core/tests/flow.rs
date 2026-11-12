//! 阶段 3 数据链路的端到端测试：用开发期主密码 123456 建库 → 分类/条目增删改 → 重开解锁读回，
//! 并复查库文件里没有任何敏感明文。不依赖 Tauri / WebView，故可在本机直接跑。

use std::fs;
use std::path::PathBuf;

use mend_core::{backup, crypto, db, entries, presets, vault};

fn temp_db(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mend-flow-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("创建临时目录");
    dir.join(db::DB_FILE_NAME)
}

fn bytes_contains(haystack: &[u8], needle: &str) -> bool {
    let pattern = needle.as_bytes();
    haystack.windows(pattern.len()).any(|w| w == pattern)
}

fn sample_input() -> entries::EntryInput {
    entries::EntryInput {
        category_id: Some("cat-work".into()),
        title: "公司 VPN".into(),
        url: Some("https://vpn.example.com".into()),
        username: "alice-user".into(),
        password: "S3cret-明文".into(),
        email: "alice@example.com".into(),
        phone: "13800138000".into(),
        notes: "## 登录步骤\n- 先连内网\n- 再输入动态口令".into(),
        favorite: true,
        tags: vec!["工作".into(), "vpn".into()],
    }
}

#[test]
fn preset_crud_is_encrypted_on_disk() {
    let path = temp_db("preset");
    let keys = {
        let conn = db::open_and_migrate(&path).expect("建库");
        let keys = vault::setup(&conn, "123456").expect("设置主密码");
        let dek = keys.dek_bytes();

        let input = presets::PresetInput {
            field_type: "email".into(),
            label: "工作邮箱".into(),
            value: "preset-secret@example.com".into(),
        };
        let row = presets::encrypt_input(&dek, "preset-1", &input, 1, 1000).expect("加密预设");
        db::insert_preset(&conn, &row).expect("写入预设");

        let list = db::list_presets(&conn).expect("列出预设");
        assert_eq!(list.len(), 1);
        let view = presets::decrypt_row(&dek, &list[0]).expect("解密预设");
        assert_eq!(view.value, "preset-secret@example.com");
        assert_eq!(view.field_type, "email");
        keys
    };

    // 库文件里不应出现预设值的明文
    let raw = fs::read(&path).expect("读库文件");
    assert!(!bytes_contains(&raw, "preset-secret@example.com"));

    {
        let conn = db::open_and_migrate(&path).expect("重开库");
        let dek = keys.dek_bytes();
        let input = presets::PresetInput {
            field_type: "phone".into(),
            label: "备用手机".into(),
            value: "13900139000".into(),
        };
        let row = presets::encrypt_input(&dek, "preset-1", &input, 1, 1000).expect("更新加密");
        db::update_preset(&conn, &row).expect("更新预设");
        let view = presets::decrypt_row(&dek, &db::list_presets(&conn).unwrap()[0]).unwrap();
        assert_eq!(view.value, "13900139000");
        assert_eq!(view.field_type, "phone");

        db::delete_preset(&conn, "preset-1").expect("删除预设");
        assert!(db::list_presets(&conn).unwrap().is_empty());
    }

    let _ = fs::remove_dir_all(path.parent().expect("父目录"));
}

#[test]
fn backup_export_import_roundtrip_restores_same_vault() {
    let path = temp_db("backup");
    let (blob, expected_counts) = {
        let conn = db::open_and_migrate(&path).expect("建库");
        let keys = vault::setup(&conn, "123456").expect("设置主密码");
        db::create_category(&conn, "cat-work", "工作", None, None).expect("建分类");
        let entry = entries::encrypt_input(&keys.dek_bytes(), "e-1", &sample_input(), 2000, 2000)
            .expect("加密条目");
        db::insert_entry(&conn, &entry).expect("写条目");

        let (salt, kdf) = vault::read_salt_and_kdf(&conn).expect("读 salt/kdf");
        let kek = crypto::derive_kek("123456", &salt, kdf).expect("派生 KEK");
        let db_bytes = fs::read(&path).expect("读库文件");
        let blob = backup::export(&db_bytes, &kek, &salt, kdf).expect("导出备份");
        let counts = (
            db::list_entries(&conn, None, None).unwrap().len(),
            db::list_categories(&conn).unwrap().len(),
        );
        (blob, counts)
    };

    // 备份文件是密文：不含库里的账号/密码明文
    assert!(backup::is_backup(&blob));
    assert!(!bytes_contains(&blob, "S3cret-明文"));
    assert!(!bytes_contains(&blob, "alice-user"));

    // 解密到临时位置并校验，等同应用内导入流程
    let payload = backup::import(&blob, "123456").expect("解密备份");
    let restored_path = path.parent().unwrap().join("restored.db");
    fs::write(&restored_path, &payload).expect("写恢复文件");

    let conn = db::open_and_migrate(&restored_path).expect("打开恢复库");
    let keys = vault::unlock(&conn, "123456").expect("用同一主密码解锁恢复库");
    let restored = db::list_entries(&conn, None, None).expect("读条目");
    assert_eq!(restored.len(), expected_counts.0);
    assert_eq!(db::list_categories(&conn).unwrap().len(), expected_counts.1);
    let entry = entries::decrypt_row(&keys.dek_bytes(), &restored[0]).expect("解密条目");
    assert_eq!(entry.password, "S3cret-明文");
    assert_eq!(entry.title, "公司 VPN");

    let _ = fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn backup_rejects_wrong_password_and_tampering() {
    let path = temp_db("backup-bad");
    let blob = {
        let conn = db::open_and_migrate(&path).expect("建库");
        vault::setup(&conn, "123456").expect("设置主密码");
        let (salt, kdf) = vault::read_salt_and_kdf(&conn).unwrap();
        let kek = crypto::derive_kek("123456", &salt, kdf).unwrap();
        backup::export(&fs::read(&path).unwrap(), &kek, &salt, kdf).unwrap()
    };

    assert!(backup::import(&blob, "wrong-pass").is_err());
    let mut tampered = blob.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x01;
    assert!(backup::import(&tampered, "123456").is_err());

    let _ = fs::remove_dir_all(path.parent().unwrap());
}

/// 回收站用不带分类的条目，避免临时库里补建分类。
fn trash_input() -> entries::EntryInput {
    let mut input = sample_input();
    input.category_id = None;
    input
}

#[test]
fn trash_soft_delete_restore_and_purge() {
    let path = temp_db("trash");
    let conn = db::open_and_migrate(&path).expect("建库");
    let keys = vault::setup(&conn, "123456").expect("设置主密码");
    let dek = keys.dek_bytes();

    let row = entries::encrypt_input(&dek, "t-1", &trash_input(), 1000, 1000).expect("加密");
    db::insert_entry(&conn, &row).expect("写条目");
    let row2 = entries::encrypt_input(&dek, "t-2", &trash_input(), 1000, 1000).expect("加密");
    db::insert_entry(&conn, &row2).expect("写条目");

    db::delete_entry(&conn, "t-1").expect("软删除");
    // 正常列表看不到，回收站能看到，且密文仍可解密
    assert_eq!(db::list_entries(&conn, None, None).unwrap().len(), 1);
    let trashed = db::list_trashed_entries(&conn).expect("回收站列表");
    assert_eq!(trashed.len(), 1);
    assert!(trashed[0].deleted_at.is_some());
    let view = entries::decrypt_row(&dek, &trashed[0]).expect("解密回收站条目");
    assert_eq!(view.password, "S3cret-明文");

    db::restore_entry(&conn, "t-1").expect("恢复");
    assert_eq!(db::list_entries(&conn, None, None).unwrap().len(), 2);
    assert!(db::list_trashed_entries(&conn).unwrap().is_empty());

    // 彻底删除只接受回收站里的条目：正常条目直接 purge 应失败
    assert!(db::purge_entry(&conn, "t-2").is_err());
    db::delete_entry(&conn, "t-2").expect("软删除");
    db::purge_entry(&conn, "t-2").expect("彻底删除");
    assert_eq!(db::list_trashed_entries(&conn).unwrap().len(), 0);

    // 清空回收站
    db::delete_entry(&conn, "t-1").unwrap();
    assert_eq!(db::purge_all_trashed(&conn).unwrap(), 1);
    assert_eq!(db::list_entries(&conn, None, None).unwrap().len(), 0);

    let _ = fs::remove_dir_all(path.parent().unwrap());
}

/// 归档条目用不带分类的条目，避免临时库里补建分类。
fn archive_input() -> entries::EntryInput {
    let mut input = sample_input();
    input.category_id = None;
    input
}

#[test]
fn archive_unarchive_roundtrip_keeps_main_and_archive_lists_orthogonal() {
    let path = temp_db("archive");
    let conn = db::open_and_migrate(&path).expect("建库");
    let keys = vault::setup(&conn, "123456").expect("设置主密码");
    let dek = keys.dek_bytes();

    let row = entries::encrypt_input(&dek, "a-1", &archive_input(), 1000, 1000).expect("加密");
    db::insert_entry(&conn, &row).expect("写条目");
    let row2 = entries::encrypt_input(&dek, "a-2", &archive_input(), 1000, 1000).expect("加密");
    db::insert_entry(&conn, &row2).expect("写条目");
    assert_eq!(db::list_entries(&conn, None, None).unwrap().len(), 2);

    // 归档：不出现在主列表，出现在归档列表，密文仍可解密，且不进回收站
    db::archive_entry(&conn, "a-1").expect("归档");
    assert_eq!(db::list_entries(&conn, None, None).unwrap().len(), 1);
    assert_eq!(db::list_entries(&conn, None, None).unwrap()[0].id, "a-2");
    let archived = db::list_archived_entries(&conn).expect("归档列表");
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0].id, "a-1");
    assert!(archived[0].archived);
    assert!(db::list_trashed_entries(&conn).unwrap().is_empty());
    // 归档条目不可删除（不会进入回收站）
    assert!(db::delete_entry(&conn, "a-1").is_err());
    assert!(db::list_trashed_entries(&conn).unwrap().is_empty());

    // 取消归档：回到主列表，归档列表清空
    db::unarchive_entry(&conn, "a-1").expect("取消归档");
    assert_eq!(db::list_entries(&conn, None, None).unwrap().len(), 2);
    assert!(db::list_archived_entries(&conn).unwrap().is_empty());
    let restored = db::list_entries(&conn, None, None)
        .expect("主列表")
        .into_iter()
        .find(|row| row.id == "a-1")
        .expect("归档条目已回到主列表");
    let view = entries::decrypt_row(&dek, &restored).expect("解密");
    assert_eq!(view.password, "S3cret-明文");

    let _ = fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn short_master_password_policy_and_three_char_rejected() {
    let path = temp_db("policy");
    let conn = db::open_and_migrate(&path).expect("建库");

    assert!(vault::setup(&conn, "123").is_err(), "3 位应被拒绝");
    assert!(
        vault::setup(&conn, "123456").is_ok(),
        "开发期主密码 123456 应被接受"
    );

    let _ = fs::remove_dir_all(path.parent().expect("父目录"));
}

#[test]
fn category_and_entry_crud_survives_reopen_and_stays_encrypted() {
    let path = temp_db("crud");

    // 1) 首次建库：开发期主密码
    let keys = {
        let conn = db::open_and_migrate(&path).expect("建库");
        let keys = vault::setup(&conn, "123456").expect("设置主密码");
        assert!(db::is_initialized(&conn).expect("查询初始化状态"));

        // 2) 分类增改（颜色走命令层同款校验后写入）
        db::create_category(&conn, "cat-work", "工作", None, None).expect("创建分类");
        let cats = db::list_categories(&conn).expect("列出分类");
        assert_eq!(cats.len(), 1);
        let color = db::validate_category_color(&Some("#a1b2c3".into())).expect("校验颜色");
        db::rename_category(
            &conn,
            "cat-work",
            "工作（内网）",
            color.as_deref(),
            Some("work"),
        )
        .expect("重命名分类");
        let cats = db::list_categories(&conn).expect("列出分类");
        assert_eq!(cats[0].color.as_deref(), Some("#A1B2C3"));
        assert_eq!(cats[0].icon.as_deref(), Some("work"));

        // 3) 条目新增
        let dek = keys.dek_bytes();
        let row =
            entries::encrypt_input(&dek, "entry-1", &sample_input(), 1000, 1000).expect("加密");
        db::insert_entry(&conn, &row).expect("写入条目");

        // 4) 列表 + 分类/关键字过滤（前端同款调用：先全量，再本地过滤）
        let by_cat = db::list_entries(&conn, Some("cat-work"), None).expect("按分类查");
        assert_eq!(by_cat.len(), 1);
        let by_kw = db::list_entries(&conn, None, Some("VPN")).expect("按标题关键字查");
        assert_eq!(by_kw.len(), 1);

        // 5) 读回明文
        let view = entries::decrypt_row(&dek, &by_cat[0]).expect("解密");
        assert_eq!(view.password, "S3cret-明文");
        assert_eq!(view.username, "alice-user");
        assert!(view.favorite);
        keys
    };

    // 6) 更新密码（模拟编辑弹窗保存）
    {
        let conn = db::open_and_migrate(&path).expect("重开库");
        let dek = keys.dek_bytes();
        let mut input = sample_input();
        input.password = "NewPass-明文".into();
        let row = entries::encrypt_input(&dek, "entry-1", &input, 1000, 2000).expect("重新加密");
        db::update_entry(&conn, &row).expect("更新条目");
    }

    // 7) 库文件字节复查：敏感明文不存在，标题（明文元信息）在
    let raw = fs::read(&path).expect("读库文件");
    assert!(bytes_contains(&raw, "公司 VPN"), "标题应作为明文元信息存在");
    for secret in [
        "S3cret-明文",
        "NewPass-明文",
        "alice-user",
        "alice@example.com",
        "13800138000",
        "先连内网",
        "123456",
    ] {
        assert!(
            !bytes_contains(&raw, secret),
            "数据库文件里不应出现明文：{secret}"
        );
    }

    // 8) 重开应用：错误密码被拒，正确密码解锁后能读回新密码
    {
        let conn = db::open_and_migrate(&path).expect("重开库");
        assert!(
            vault::unlock(&conn, "wrong-pass").is_err(),
            "错误密码应被拒绝"
        );
        let keys = vault::unlock(&conn, "123456").expect("正确密码解锁");
        let list = db::list_entries(&conn, None, None).expect("全量列出");
        assert_eq!(list.len(), 1);
        let view = entries::decrypt_row(&keys.dek_bytes(), &list[0]).expect("解密");
        assert_eq!(view.password, "NewPass-明文");
        assert_eq!(view.updated_at, 2000);
    }

    // 9) 删除分类：条目归入未分类而不是被删
    {
        let conn = db::open_and_migrate(&path).expect("重开库");
        db::delete_category(&conn, "cat-work").expect("删除分类");
        let list = db::list_entries(&conn, None, None).expect("全量列出");
        assert_eq!(list.len(), 1, "删除分类不应删掉条目");
        assert!(list[0].category_id.is_none(), "条目应变为未分类");
        assert!(db::list_categories(&conn).expect("列出分类").is_empty());

        db::delete_entry(&conn, "entry-1").expect("删除条目");
        assert!(db::list_entries(&conn, None, None)
            .expect("全量列出")
            .is_empty());
    }

    let _ = fs::remove_dir_all(path.parent().expect("父目录"));
}

/// 手动排序落库后跨重启稳定：建库 → 插入条目（取桶内 max+1）→ 模拟拖拽重排
/// → 重开库读回，`sort_order` 与拖拽结果一致，且重复迁移幂等。
#[test]
fn entry_manual_sort_order_persists_across_reopen() {
    let path = temp_db("sort-order");

    {
        let conn = db::open_and_migrate(&path).expect("建库");
        let keys = vault::setup(&conn, "123456").expect("设置主密码");
        let dek = keys.dek_bytes();
        db::create_category(&conn, "cat-work", "工作", None, None).expect("建分类");

        // 新建条目：命令层按桶内 max+1 赋值，逐条递增（1/2/3）
        for (id, title) in [("e-a", "A"), ("e-b", "B"), ("e-c", "C")] {
            let mut input = sample_input();
            input.title = title.into();
            let mut row = entries::encrypt_input(&dek, id, &input, 1000, 1000).expect("加密");
            row.sort_order = db::next_entry_sort_order(&conn, Some("cat-work")).expect("取排序号");
            db::insert_entry(&conn, &row).expect("写条目");
        }

        let before: Vec<i64> = ["e-a", "e-b", "e-c"]
            .iter()
            .map(|id| {
                db::get_entry(&conn, id)
                    .expect("读取")
                    .expect("存在")
                    .sort_order
            })
            .collect();
        assert_eq!(before, vec![1, 2, 3]);

        // 模拟拖拽：c → a → b
        db::reorder_entries(
            &conn,
            &["e-c".to_string(), "e-a".to_string(), "e-b".to_string()],
        )
        .expect("重排");
    }

    // 重开库：排序号已落盘且与拖拽结果一致
    {
        let conn = db::open_and_migrate(&path).expect("重开库");
        let order: Vec<i64> = ["e-a", "e-b", "e-c"]
            .iter()
            .map(|id| {
                db::get_entry(&conn, id)
                    .expect("读取")
                    .expect("存在")
                    .sort_order
            })
            .collect();
        assert_eq!(order, vec![1, 2, 0], "c=0, a=1, b=2");

        // 迁移幂等：重复执行不报错、版本保持 4
        db::migrate(&conn).expect("重复迁移");
        assert_eq!(
            db::meta_get(&conn, "schema_version")
                .expect("读版本")
                .as_deref(),
            Some("4")
        );
    }

    let _ = fs::remove_dir_all(path.parent().expect("父目录"));
}
