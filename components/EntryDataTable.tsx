import { computed, signal, Text, View } from 'nsh'
import {
  DataTable,
  type DataTableCell,
  type DataTableColumn,
  type DataTableHeaderCell,
  type DataTableRef,
} from 'nsh/base'
import { t } from 'nsh/i18n'

import {
  currentCategoryId,
  displayedEntries,
  fieldsLoading,
  hasMoreEntries,
  loadedCount,
  loadMoreEntries,
  selectEntry,
  toggleSelectAll,
  visibleEntries,
} from '../lib/state'
import { preferences } from '../lib/preferences'
import type { ColumnKey, TableColumnKey } from '../lib/types'
import {
  categoryOf,
  contactRows,
  credentialsRows,
  EntryActions,
  EntryCheckbox,
  EntryFieldPair,
  EntryNotesCell,
  EntryTitleCell,
  FIELD_PAIR_COMPACT_WIDTH,
  SelectAllCheckbox,
} from './EntryCells'
import { fullTextTip } from './ui'

type NshNode = ReturnType<typeof View>

/** 固定列宽：选择 / 分类 / 操作都不参与平分，也不允许拖动改宽。 */
const CHECK_COLUMN_WIDTH = 32
const CATEGORY_COLUMN_WIDTH = 120
const ACTIONS_COLUMN_WIDTH = 160
/** 平分的下限：窗口极窄时保证每列还放得下省略号，而不是被压成 0。 */
const FLEX_COLUMN_MIN = 40
/** onLayout 拿到真实宽度之前的第一帧用这个名义宽度，避免列宽算成 0。 */
const NOMINAL_TABLE_WIDTH = 1000
/** 表头高度与表根 1px 边框：自绘竖线要和固定列边缘线一样从表头下缘画到表底。 */
const TABLE_HEADER_HEIGHT = 34
const TABLE_BORDER_WIDTH = 1

type ColumnDef = {
  key: TableColumnKey
  title: string
  /** 除固定列外，其余列一起平分剩余宽度。 */
  flex: boolean
  fixed?: 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  movable?: boolean
  selectable?: boolean
}

/** 固定列用恒定宽度，其余列参与平分。 */
function fixedWidth(key: TableColumnKey): number {
  if (key === 'check') return CHECK_COLUMN_WIDTH
  if (key === 'category') return CATEGORY_COLUMN_WIDTH
  return ACTIONS_COLUMN_WIDTH
}

function buildColumnDefs(): ColumnDef[] {
  const defs: ColumnDef[] = [
    {
      key: 'check',
      title: '',
      flex: false,
      fixed: 'left',
      movable: false,
      selectable: false,
    },
    { key: 'name', title: t('entry.title'), flex: true, fixed: 'left' },
  ]
  if (!currentCategoryId()) {
    defs.push({
      key: 'category',
      title: t('entry.category'),
      flex: false,
    })
  }
  const optional: { key: ColumnKey; title: string }[] = [
    { key: 'credentials', title: t('entry.columnCredentials') },
    { key: 'contact', title: t('entry.columnContact') },
    { key: 'notes', title: t('entry.notes') },
  ]
  for (const col of optional) {
    if (!preferences().visibleColumns[col.key]) continue
    defs.push({ key: col.key, title: col.title, flex: true })
  }
  defs.push({
    key: 'actions',
    title: t('common.actions'),
    flex: false,
    fixed: 'right',
    align: 'center',
    movable: false,
    selectable: false,
  })
  return defs
}

/** DataTable 自带双向虚拟化，只创建视野里的单元格；这里只持有当前已解密窗口。 */
export function EntryDataTable(props: { empty: NshNode }) {
  const tableRef = signal<DataTableRef | null>(null)
  const tableWidth = signal(0)

  const columnDefs = computed<ColumnDef[]>(() => buildColumnDefs())

  /** DataTable 的自定义表头槽位按列序号复用，中间删列（进分类视图去掉分类列、
   *  列配置关掉中间列）时旧槽位不会重渲染，表头会停留在旧列上。
   *  用列键签名做 Each 的键：列集合一变就整表重建；仅宽度变化（窗口缩放）不重建。 */
  const columnSignature = computed(() =>
    columnDefs()
      .map((def) => def.key)
      .join('|'),
  )

  /** 列宽不持久化、不可拖：固定列吃掉恒定宽度，其余列平分剩余空间，
   *  窗口缩放时 onLayout 更新 tableWidth，整张表跟着重新平分。 */
  const columns = computed<DataTableColumn[]>(() => {
    const defs = columnDefs()
    const total = tableWidth() > 0 ? tableWidth() : NOMINAL_TABLE_WIDTH
    const fixed = defs.reduce((sum, def) => sum + (def.flex ? 0 : fixedWidth(def.key)), 0)
    const flexDefs = defs.filter((def) => def.flex)
    const available = Math.max(total - fixed, flexDefs.length * FLEX_COLUMN_MIN)
    const each = flexDefs.length > 0 ? Math.floor(available / flexDefs.length) : 0
    let extra = available - each * flexDefs.length
    return defs.map((def) => {
      let width: number
      if (!def.flex) {
        width = fixedWidth(def.key)
      } else {
        width = each
        if (extra > 0) {
          width += 1
          extra -= 1
        }
      }
      return {
        key: def.key,
        title: def.title,
        width,
        minWidth: def.flex ? FLEX_COLUMN_MIN : width,
        maxWidth: def.flex ? 100_000 : width,
        fixed: def.fixed,
        align: def.align,
        movable: def.movable,
        selectable: def.selectable,
      }
    })
  })

  /** 分类列右缘的浅灰竖线，与固定列边缘线同款（1px `bg-border`）。
   *  DataTable 只给固定区画边缘线（标题列右缘那条），分类列不是固定列，所以这条自己画；
   *  那条线被不透明表头盖住表头段，看起来从表头下缘贯穿到表底（含空白区），这里对齐同款范围。
   *  出现横向滚动（极窄窗口）时不画：拿不到像素级 scroll 偏移，画了会跟错列。 */
  const categoryEdgeLeft = computed<number | null>(() => {
    if (!columnDefs().some((def) => def.key === 'category')) return null
    const widths = columns()
    const total = widths.reduce((sum, column) => sum + (column.width ?? 0), 0)
    if (tableWidth() <= 0 || total > tableWidth()) return null
    let x = 0
    for (const column of widths) {
      x += column.width ?? 0
      if (column.key === 'category') return x - 1
    }
    return null
  })

  /** 均分后列宽可能很窄：字段格据此决定是否让「账号：」前缀让位给值。
   *  走 accessor 而不是快照，窗口缩放后回收槽位里的旧单元格也能跟着变。 */
  function pairCompact(key: TableColumnKey): boolean {
    const width = columns().find((column) => column.key === key)?.width ?? 0
    return width > 0 && width < FIELD_PAIR_COMPACT_WIDTH
  }

  /** DataTable 的单元格会被回收：所有内容都通过 accessor 读 signal，
   *  这样插入新条目或字段解密完成时，旧槽位也能显示新行的内容。 */
  function renderCell(cell: DataTableCell): NshNode {
    return (
      <If when={displayedEntries()[cell.row]}>
        {(entry) => {
          const category = () => categoryOf(entry())
          switch (cell.key) {
            case 'check':
              return <EntryCheckbox entry={entry} />
            case 'name':
              return <EntryTitleCell entry={entry} category={category} />
            case 'category':
              return (
                <Text
                  class="text-[11px] text-muted-foreground"
                  style={{ numberOfLines: 1 }}
                  tooltip={fullTextTip(category()?.name ?? t('entry.uncategorized'))}
                >
                  {category()?.name ?? t('entry.uncategorized')}
                </Text>
              )
            case 'credentials':
              return (
                <EntryFieldPair
                  rows={() => credentialsRows(entry())}
                  compact={() => pairCompact('credentials')}
                />
              )
            case 'contact':
              return (
                <EntryFieldPair
                  rows={() => contactRows(entry())}
                  compact={() => pairCompact('contact')}
                />
              )
            case 'notes':
              return <EntryNotesCell entry={entry} />
            case 'actions':
              return <EntryActions entry={entry} />
            default:
              return <Text class="text-[11px] text-foreground">{cell.text}</Text>
          }
        }}
      </If>
    )
  }

  function renderHeaderCell(cell: DataTableHeaderCell): NshNode {
    if (cell.key === 'check') {
      return <SelectAllCheckbox onChange={() => toggleSelectAll()} />
    }
    return (
      <View
        class={'h-full flex-row items-center ' + (cell.key === 'actions' ? 'justify-center' : '')}
        testID={`table-header-${cell.key}`}
      >
        <Text class="text-[11px] font-medium text-muted-foreground" style={{ numberOfLines: 1 }}>
          {cell.title}
        </Text>
      </View>
    )
  }

  return (
    <View class="relative mx-4 mb-1 min-h-0 flex-1">
      <Each of={[columnSignature()]}>
        {() => (
          <DataTable
            ref={(ref) => tableRef.set(ref)}
            onLayout={({ bounds }) => {
              const width = Math.round(bounds.size.width)
              if (width > 0 && width !== tableWidth()) tableWidth.set(width)
            }}
            columns={columns()}
            data={displayedEntries()}
            dataStart={0}
            rowCount={visibleEntries().length}
            rowHeight={56}
            headerHeight={TABLE_HEADER_HEIGHT}
            rowHeader={false}
            stripe
            rowSelectable
            columnSelectable={false}
            cellSelectable={false}
            selectOnModifierPress={false}
            selection={null}
            movableColumns={false}
            resizableColumns={false}
            hasMore={hasMoreEntries()}
            loading={fieldsLoading()}
            loadMoreThreshold={40}
            scrollbar
            accessibilityLabel={t('entry.listTitle')}
            empty={props.empty}
            classes={{
              // nsh DataTable 在表体上方盖了一层 hit layer 转发点击/悬停，光标 pick
              // 命中的是它而非 cell 里的按钮，按钮自身的 cursor-pointer 会被挡住。
              // root 是 hit layer 的祖先，光标沿父链上溯到这里取到手型（表格 rowSelectable
              // 本就是可交互区，整表手型与卡片视图一致）。
              root: 'cursor-pointer rounded-xl border border-border bg-card',
              header: 'bg-secondary',
              headerCell: 'px-2',
              headerContent: 'gap-1',
              cell: 'px-2',
              row: '',
              rowOdd: 'bg-muted/20',
              rowHover: 'bg-accent/70',
              rowSelected: 'bg-primary/5',
              fixedEdge: 'bg-border',
              empty: 'p-6',
            }}
            renderCell={renderCell}
            renderHeaderCell={renderHeaderCell}
            onRowPress={({ row }) => {
              const entry = displayedEntries()[row]
              if (entry) void selectEntry(entry.id)
            }}
            onVisibleRowsChange={({ range }) => {
              // DataTable 的 rowCount 是全表，但 data 只持有已解密窗口；视野接近窗口末尾就提前补密。
              if (range.end + 80 >= loadedCount() && hasMoreEntries()) loadMoreEntries()
            }}
            onLoadMore={() => loadMoreEntries()}
            class="h-full w-full"
          />
        )}
      </Each>
      <If when={categoryEdgeLeft() !== null}>
        <View
          class="pointer-events-none absolute w-px bg-border"
          style={{
            left: categoryEdgeLeft() ?? 0,
            top: TABLE_BORDER_WIDTH + TABLE_HEADER_HEIGHT,
            bottom: TABLE_BORDER_WIDTH,
          }}
          testID="category-edge"
        />
      </If>
    </View>
  )
}
