import { effect, Scroll, signal, Text, View, windowSize } from 'nsh'
import { Dialog, Tab, Tabs, TextView } from 'nsh/base'
import { t } from 'nsh/i18n'

import { entryNotes, notesEditor, saveEntryNotes } from '../lib/state'
import {
  ActionButton,
  IconButton,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
  TextField,
} from './ui'

/** 备注编辑弹窗：无 props，完全由 `notesEditor()` 驱动。
 *  - null   → 不渲染（Dialog 被 `<If>` 摘掉）
 *  - 字符串 → 以该 id 打开，初值取 `entryNotes()[id]`
 *  关闭统一走 `notesEditor.set(null)`；保存时先 `saveEntryNotes` 再关闭。 */
export function NotesDialog() {
  // 组件函数只跑一次（Solid 语义）：用 effect 在每次「打开」时把编辑文本
  // 重置成该条目的备注，避免上次编辑的内容被带到下一条。
  const text = signal('')
  const tab = signal<'edit' | 'preview'>('preview')

  effect(() => {
    const id = notesEditor()
    if (id !== null) {
      text.set(entryNotes()[id] ?? '')
      // 默认落在预览页，先看到渲染后的 Markdown；想改再切到「编辑」。
      tab.set('preview')
    }
  })

  function close() {
    notesEditor.set(null)
  }

  function save() {
    const id = notesEditor()
    if (id === null) return
    saveEntryNotes(id, text())
    // saveEntryNotes 内部会 toast；这里同步关闭，toast 由主界面的 ToastHost 显示。
    notesEditor.set(null)
  }

  return (
    <If when={notesEditor() !== null}>
      <Dialog
        open={true}
        closeOnBackdropPress={false}
        animation="fade"
        accessibilityLabel={t('entry.editNotes')}
        class={MODAL_CLASS}
        backdropClass={MODAL_BACKDROP_CLASS}
        style={{ width: 560, maxWidth: '94%' }}
        onCancel={close}
      >
        <ModalFrame
          class="overflow-hidden rounded-xl border border-border bg-card shadow-xl"
          maxHeight={Math.max(360, windowSize().height - 72)}
        >
          <View class="gap-3 p-4">
            <View class="flex-row items-center justify-between">
              <Text class="text-sm font-semibold text-foreground">{t('entry.editNotes')}</Text>
              <IconButton icon="close" label={t('common.close')} onPress={close} />
            </View>

            <View class="gap-2">
              <View class="flex-row items-center justify-between">
                <Text class="text-xs font-medium text-muted-foreground">{t('entry.notes')}</Text>
                <Tabs class="flex-row gap-1 rounded-md bg-muted p-0.5">
                  <Tab
                    selected={tab() === 'edit'}
                    onPress={() => tab.set('edit')}
                    class="rounded px-2.5 py-1 selected:bg-card"
                  >
                    <Text class="text-xs text-foreground">{t('entry.notesEdit')}</Text>
                  </Tab>
                  <Tab
                    selected={tab() === 'preview'}
                    onPress={() => tab.set('preview')}
                    class="rounded px-2.5 py-1 selected:bg-card"
                  >
                    <Text class="text-xs text-foreground">{t('entry.notesPreview')}</Text>
                  </Tab>
                </Tabs>
              </View>

              <If when={tab() === 'edit'}>
                {/* 固定高度 + 裁剪：挡住多行 Input 向外层报高度，滚动交给 Input 自己。 */}
                <View class="overflow-hidden" style={{ height: 220 }}>
                  <TextField
                    value={text()}
                    onChange={text.set}
                    multiline
                    placeholder={t('entry.notesPlaceholder')}
                    accessibilityLabel={t('entry.notes')}
                    class="h-full"
                    style={{
                      paddingTop: 10,
                      paddingBottom: 10,
                      paddingLeft: 12,
                      paddingRight: 12,
                    }}
                  />
                </View>
              </If>

              <If when={tab() === 'preview'}>
                <View
                  class="rounded-md border border-input bg-background p-3"
                  style={{ height: 220 }}
                >
                  <Scroll class="flex-1">
                    <If when={text().trim().length > 0}>
                      <TextView
                        markdown={text()}
                        selectable
                        links="open"
                        class="text-xs text-foreground"
                        classes={{
                          heading1: 'text-sm font-semibold',
                          heading2: 'text-xs font-semibold',
                          heading3: 'text-xs font-semibold',
                          code: 'font-mono bg-muted',
                          link: 'text-primary underline',
                        }}
                      />
                    </If>
                    <If when={text().trim().length === 0}>
                      <Text class="text-xs text-muted-foreground">{t('entry.noNotes')}</Text>
                    </If>
                  </Scroll>
                </View>
              </If>
            </View>

            <View class="flex-row justify-end gap-2 pt-1">
              <ActionButton label={t('common.cancel')} variant="ghost" onPress={close} />
              <ActionButton
                label={t('common.save')}
                variant="primary"
                icon="check"
                onPress={save}
              />
            </View>
          </View>
        </ModalFrame>
      </Dialog>
    </If>
  )
}
