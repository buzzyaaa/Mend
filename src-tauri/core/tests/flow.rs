//! 阶段 3 数据链路的端到端测试：用开发期主密码 123456 建库 → 分类/条目增删改 → 重开解锁读回，
//! 并复查库文件里没有任何敏感明文。不依赖 Tauri / WebView，故可在本机直接跑。

use std::fs;
use std::path::PathBuf;

use mend_core::{db, entries, vault};

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
    }
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

        // 2) 分类增改
        db::create_category(&conn, "cat-work", "工作").expect("创建分类");
        let cats = db::list_categories(&conn).expect("列出分类");
        assert_eq!(cats.len(), 1);
        db::rename_category(&conn, "cat-work", "工作（内网）").expect("重命名分类");

        // 3) 条目新增
        let dek = keys.dek_bytes();
        let row = entries::encrypt_input(&dek, "entry-1", &sample_input(), 1000, 1000).expect("加密");
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
        assert!(vault::unlock(&conn, "wrong-pass").is_err(), "错误密码应被拒绝");
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
        assert!(db::list_entries(&conn, None, None).expect("全量列出").is_empty());
    }

    let _ = fs::remove_dir_all(path.parent().expect("父目录"));
}
