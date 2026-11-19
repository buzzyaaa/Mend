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
  tableLayoutVersion,
  toggleSelectAll,
  visibleEntries,
} from '../lib/state'
import { columnWidthRange, preferences } from '../lib/preferences'
import type { ColumnKey, ResizableColumnKey } from '../lib/types'
import {
  categoryOf,
  contactRows,
  credentialsRows,
  EntryActions,
  EntryCheckbox,
  EntryFieldPair,
  EntryNotesCell,
  EntryTitleCell,
  SelectAllCheckbox,
} from './EntryCells'

type NshNode = ReturnType<typeof View>

/** 选择列 / 操作列宽度恒定：两者都不参与平均分配，也不允许拖动。 */
const CHECK_COLUMN_WIDTH = 32
const ACTIONS_COLUMN_WIDTH = 232
/** 平分时标题列的保底宽：行首图标 + 两个标签胶囊，低于这个就被裁掉。
 *  宽窗口下平分值会大于它，此时仍是完全平均分配。 */
const NAME_DISTRIBUTION_MIN = 180
/** onLayout 拿到真实宽度之前的第一帧用这个名义宽度，避免列宽算成 0。 */
const NOMINAL_TABLE_WIDTH = 1000

type ColumnDef = {
  key: ResizableColumnKey
  title: string
  /** 除选择列与操作列外，其余列一起平分可用宽度。 */
  flex: boolean
  fixed?: 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  resizable?: boolean
  movable?: boolean
  selectable?: boolean
  fitPadding?: number
}

/** 固定列用恒定宽度，其余列参与平分。 */
function fixedWidth(key: ResizableColumnKey): number {
  return key === 'check' ? CHECK_COLUMN_WIDTH : ACTIONS_COLUMN_WIDTH
}

function buildColumnDefs(): ColumnDef[] {
  const defs: ColumnDef[] = [
    {
      key: 'check',
      title: '',
      flex: false,
      fixed: 'left',
      resizable: false,
      movable: false,
      selectable: false,
    },
    { key: 'name', title: t('entry.title'), flex: true, fixed: 'left', fitPadding: 40 },
  ]
  if (!currentCategoryId()) {
    defs.push({
      key: 'category',
      title: t('entry.category'),
      flex: true,
      fitPadding: 16,
    })
  }
  const optional: { key: ColumnKey; title: string }[] = [
    { key: 'credentials', title: t('entry.columnCredentials') },
    { key: 'contact', title: t('entry.columnContact') },
    { key: 'notes', title: t('entry.notes') },
  ]
  for (const col of optional) {
    if (!preferences().visibleColumns[col.key]) continue
    defs.push({ key: col.key, title: col.title, flex: true, fitPadding: 48 })
  }
  defs.push({
    key: 'actions',
    title: t('common.actions'),
    flex: false,
    fixed: 'right',
    align: 'center',
    resizable: false,
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

  /** 列宽不做任何持久化：每次挂载（打开视图）或窗口宽度变化都按当前宽度平分。
   *  「重置」按钮自增 tableLayoutVersion，强制重新算一遍并交回 DataTable。 */
  const columns = computed<DataTableColumn[]>(() => {
    tableLayoutVersion() // 依赖重置计数；值本身不参与计算，只要触发重算即可。
    const defs = columnDefs()
    const total = tableWidth() > 0 ? tableWidth() : NOMINAL_TABLE_WIDTH
    const fixed = defs.reduce((sum, def) => sum + (def.flex ? 0 : fixedWidth(def.key)), 0)
    const flexDefs = defs.filter((def) => def.flex)
    const minTotal = flexDefs.reduce((sum, def) => sum + columnWidthRange(def.key).min, 0)
    const available = Math.max(total - fixed, minTotal)
    const each = flexDefs.length > 0 ? Math.floor(available / flexDefs.length) : 0
    let extra = available - each * flexDefs.length
    return defs.map((def) => {
      const range = columnWidthRange(def.key)
      let width: number
      if (!def.flex) {
        // 固定列 min=max=width 且不可调整，备注拖再宽也不会拉出可拖边缘。
        width = fixedWidth(def.key)
      } else {
        // 标题列带行首图标和两个标签胶囊，需要一个保底宽；其余列按平分值。
        const floor = def.key === 'name' ? NAME_DISTRIBUTION_MIN : range.min
        width = Math.max(floor, each)
        if (extra > 0) {
          width += 1
          extra -= 1
        }
      }
      return {
        key: def.key,
        title: def.title,
        width,
        minWidth: def.flex ? range.min : width,
        maxWidth: def.flex ? range.max : width,
        fixed: def.fixed,
        align: def.align,
        resizable: def.flex,
        movable: def.movable,
        selectable: def.selectable,
        fitPadding: def.fitPadding,
      }
    })
  })

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
                <Text class="text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                  {category()?.name ?? t('entry.uncategorized')}
                </Text>
              )
            case 'credentials':
              return <EntryFieldPair rows={() => credentialsRows(entry())} />
            case 'contact':
              return <EntryFieldPair rows={() => contactRows(entry())} />
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
      headerHeight={34}
      rowHeader={false}
      stripe
      rowSelectable
      columnSelectable={false}
      cellSelectable={false}
      selectOnModifierPress={false}
      selection={null}
      resizableColumns
      movableColumns={false}
      hasMore={hasMoreEntries()}
      loading={fieldsLoading()}
      loadMoreThreshold={40}
      scrollbar
      accessibilityLabel={t('entry.listTitle')}
      empty={props.empty}
      classes={{
        root: 'rounded-xl border border-border bg-card',
        header: 'bg-secondary',
        headerCell: 'px-2',
        headerContent: 'gap-1',
        cell: 'px-2',
        resizeHandle: 'bg-border group-hover:bg-primary',
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
      class="mx-4 mb-1 min-h-0 flex-1"
      style={{ flex: 1 }}
    />
  )
}
