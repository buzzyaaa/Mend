import { Scroll, signal, Text, View, windowSize } from 'nsh'
import { Dialog } from 'nsh/base'
import { t } from 'nsh/i18n'

import { confirm, removeTag, saveTag, tags, tagsOpen } from '../lib/state'
import type { Tag, TagInput } from '../lib/types'
import { TAG_COLOR_CHOICES } from './TagPill'
import {
  ActionButton,
  ColorPickerControl,
  EmptyState,
  IconButton,
  TextField,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
} from './ui'

/** 颜色比较统一按去空白 + 大写，避免 `#2563eb` 与 `#2563EB` 看起来不同。 */
function normalizeColor(color: string | null | undefined): string {
  return (color ?? '').trim().toUpperCase()
}

/** 单个标签行：默认只读（色点 + 名称 + 编辑 + 删除）；
 *  点色点/名称/编辑图标展开为「名称 + ColorPicker + 保存/取消」，保存时名称和颜色一起提交。 */
function TagRow(props: { tag: Tag }) {
  const editing = signal(false)
  const draft = signal(props.tag.name)
  const draftColor = signal(props.tag.color)
  const busy = signal(false)

  function begin() {
    if (busy()) return
    draft.set(props.tag.name)
    draftColor.set(props.tag.color)
    editing.set(true)
  }

  function cancel() {
    if (busy()) return
    editing.set(false)
  }

  const dirty = () =>
    draft().trim() !== props.tag.name ||
    normalizeColor(draftColor()) !== normalizeColor(props.tag.color)

  async function commit() {
    if (busy()) return
    const next = draft().trim()
    if (!next || !dirty()) {
      editing.set(false)
      return
    }
    busy.set(true)
    try {
      const input: TagInput = { name: next, color: draftColor() }
      const saved = await saveTag(input, props.tag.id)
      // 名称被拒（空/超长/重名）时停留在编辑态，错误已由 toast 说明，方便就地改。
      if (saved) editing.set(false)
    } finally {
      busy.set(false)
    }
  }

  const remove = () =>
    confirm.set({
      title: t('tag.edit'),
      message: t('tag.deleteConfirm', { name: props.tag.name }),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => void removeTag(props.tag.id),
    })

  const readonly = (
    <View class="flex-row items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
      <View
        class="h-6 w-6 rounded-full border border-border"
        style={{ backgroundColor: props.tag.color }}
        onPress={begin}
        role="button"
        accessibilityLabel={t('tag.color')}
      />
      <View
        class="h-7 min-w-0 flex-1 items-start justify-center rounded px-1.5 hover:bg-accent/60 active:opacity-70"
        onPress={begin}
        accessibilityLabel={props.tag.name}
      >
        <Text class="text-xs font-medium text-foreground" style={{ numberOfLines: 1 }}>
          {props.tag.name}
        </Text>
      </View>
      <IconButton icon="edit" label={t('tag.edit')} size={14} class="h-7 w-7" onPress={begin} />
      <IconButton
        icon="trash"
        label={t('common.delete')}
        size={14}
        class="h-7 w-7"
        onPress={remove}
      />
    </View>
  )

  const editor = (
    <View class="gap-2 rounded-lg border border-primary/50 bg-background p-2.5">
      <View class="flex-row items-center gap-2">
        <TextField
          value={draft()}
          onChange={draft.set}
          onSubmit={() => void commit()}
          autoFocus
          maxLength={32}
          accessibilityLabel={t('tag.name')}
          class="h-8 flex-1 border-primary bg-background px-2"
        />
        <IconButton
          icon="check"
          label={t('common.save')}
          size={14}
          class="h-7 w-7"
          disabled={busy() || !dirty()}
          onPress={() => void commit()}
        />
        <IconButton
          icon="close"
          label={t('common.cancel')}
          size={14}
          class="h-7 w-7"
          disabled={busy()}
          onPress={cancel}
        />
        <IconButton
          icon="trash"
          label={t('common.delete')}
          size={14}
          class="h-7 w-7"
          onPress={remove}
        />
      </View>
      <View class="gap-1">
        <Text class="text-[11px] text-muted-foreground">{t('tag.color')}</Text>
        <ColorPickerControl value={draftColor()} onChange={draftColor.set} />
      </View>
    </View>
  )

  return (
    <If when={editing()} else={readonly}>
      {editor}
    </If>
  )
}

/** 标签维护弹窗：标签是库内独立实体，条目编辑时只能从这里选，不能就地新建。
 *  名称重复/为空/过长由原生层校验，前端只看 toast 提示。 */
export function TagsDialog() {
  const name = signal('')
  const color = signal<string>(TAG_COLOR_CHOICES[0])
  const busy = signal(false)

  async function submit() {
    if (busy()) return
    const trimmed = name().trim()
    if (!trimmed) return
    const input: TagInput = { name: trimmed, color: color() }
    busy.set(true)
    try {
      const saved = await saveTag(input, null)
      if (saved) {
        name.set('')
        // 颜色保留：同一批标签通常共用一组配色，连续新建更快。
      }
    } finally {
      busy.set(false)
    }
  }

  return (
    <Dialog
      open={tagsOpen()}
      closeOnBackdropPress={false}
      onOpenChange={(event) => {
        if (!event.open) tagsOpen.set(false)
      }}
      onCancel={() => tagsOpen.set(false)}
      accessibilityLabel={t('tag.title')}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      style={{ width: 560, maxWidth: '94%' }}
    >
      <ModalFrame
        class="gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-xl"
        maxHeight={Math.max(340, windowSize().height - 80)}
      >
        <View class="flex-row items-start gap-3">
          <View class="flex-1 gap-0.5">
            <Text class="text-sm font-semibold text-foreground">{t('tag.title')}</Text>
            <Text class="text-xs text-muted-foreground">{t('tag.hint')}</Text>
          </View>
          <IconButton
            icon="close"
            label={t('common.close')}
            testID="tags-close"
            onPress={() => tagsOpen.set(false)}
          />
        </View>

        {/* 新建表单：名称 + 颜色选择器 + 新增。没有标签时这里就是唯一入口。 */}
        <View class="gap-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <View class="flex-row items-center gap-2">
            <TextField
              value={name()}
              onChange={name.set}
              placeholder={t('tag.namePlaceholder')}
              maxLength={32}
              accessibilityLabel={t('tag.name')}
              onSubmit={() => void submit()}
              class="h-8 flex-1"
            />
            <ActionButton
              label={t('tag.add')}
              variant="primary"
              icon="plus"
              disabled={busy() || !name().trim()}
              onPress={() => void submit()}
            />
          </View>
          <View class="gap-1">
            <Text class="text-[11px] text-muted-foreground">{t('tag.color')}</Text>
            <ColorPickerControl value={color()} onChange={color.set} />
          </View>
        </View>

        <Scroll class="min-h-[140px] max-h-[260px]" contentClass="gap-1.5">
          <If when={tags().length === 0}>
            <EmptyState icon="tag" title={t('tag.empty')} />
          </If>
          <Each of={tags()} key={(tag) => tag.id}>
            {(tag) => <TagRow tag={tag()} />}
          </Each>
        </Scroll>

        <View class="flex-row justify-end">
          <ActionButton
            label={t('common.close')}
            variant="secondary"
            onPress={() => tagsOpen.set(false)}
          />
        </View>
      </ModalFrame>
    </Dialog>
  )
}
