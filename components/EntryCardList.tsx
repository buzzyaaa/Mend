import { List, platform, signal, Text, View, windowSize, type ListRef } from 'nsh'
import { Scrollbar } from 'nsh/base'
import { t } from 'nsh/i18n'

import { displayedEntries, loadMoreEntries, selectEntry } from '../lib/state'
import type { EntrySummary } from '../lib/types'
import {
  categoryOf,
  contactRows,
  credentialsRows,
  EntryActions,
  EntryCheckbox,
  EntryFieldPair,
  EntryNotesCell,
  EntryTitleCell,
} from './EntryCells'

type NshNode = ReturnType<typeof View>

/** 卡片视图按窗口宽度自适应列数，窄屏一列，宽屏最多四列。 */
function cardColumns(): number {
  const width = windowSize().width
  if (platform.idiom === 'phone' || width < 560) return 1
  if (width < 900) return 2
  if (width < 1400) return 3
  return 4
}

function EntryCard(props: { entry: () => EntrySummary }) {
  const entry = props.entry
  const category = () => categoryOf(entry())

  return (
    <View
      class="gap-2 rounded-xl border border-border bg-card p-3 shadow-sm hover:border-primary/40 hover:shadow-md"
      accessibilityLabel={entry().title}
      role="button"
      onPress={() => void selectEntry(entry().id)}
    >
      <View class="flex-row items-start gap-2">
        <View class="min-w-0 flex-1">
          <EntryTitleCell entry={entry} category={category} card />
        </View>
        <View class="h-6 w-6 shrink-0">
          <EntryCheckbox entry={entry} />
        </View>
      </View>

      <View class="gap-1 rounded-lg bg-muted/30 px-2 py-2">
        <EntryFieldPair rows={() => credentialsRows(entry())} card />
        <EntryFieldPair rows={() => contactRows(entry())} card />
      </View>

      <View class="flex-row items-end justify-between gap-2 border-t border-border pt-2">
        <View class="min-w-0 flex-1 gap-0.5">
          <Text class="text-[10px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {category()?.name ?? t('entry.uncategorized')}
          </Text>
          <EntryNotesCell entry={entry} />
        </View>
        <EntryActions entry={entry} card />
      </View>
    </View>
  )
}

/** 卡片视图仍是虚拟化的 List，只挂载视野里的卡片；滚动条用 nsh Scrollbar。 */
export function EntryCardList(props: { empty: NshNode }) {
  const listRef = signal<ListRef | null>(null)

  return (
    <View class="relative mx-4 mb-1 min-h-0 flex-1 overflow-hidden">
      <List
        ref={(ref) => listRef.set(ref)}
        each={displayedEntries()}
        keyExtractor={(item) => item.id}
        numColumns={cardColumns()}
        estimatedItemSize={180}
        loadMoreThreshold={1}
        onLoadMore={() => loadMoreEntries()}
        scrollbar={false}
        class="h-full w-full"
        contentClass="gap-3 pb-3 pr-3"
        empty={props.empty}
      >
        {(item) => <EntryCard entry={item} />}
      </List>
      <Scrollbar
        scroll={listRef() ?? undefined}
        mode="hover"
        motion={{ idle: 1200, enter: 120, exit: 240 }}
        accessibilityLabel={t('entry.listTitle')}
        class="absolute inset-y-0 right-0 w-3 items-end p-0.5"
        thumbClass="w-1.5 rounded-full bg-muted-foreground/60 transition-all group-hover:w-2 hover:bg-muted-foreground/90 active:w-2"
      />
    </View>
  )
}
