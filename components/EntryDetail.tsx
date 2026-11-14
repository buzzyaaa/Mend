import { effect, Scroll, signal, Text, token, View } from 'nsh'
import { TextView } from 'nsh/base'
import { t } from 'nsh/i18n'

import { categoryEmoji } from '../lib/category-icons'
import {
  archiveEntry,
  categories,
  confirm,
  copyText,
  deleteEntry,
  detailBusy,
  entryEditor,
  openExternal,
  selected,
  selectedId,
  setTagFilter,
  toggleFavorite,
  unarchiveEntry,
} from '../lib/state'
import { formatDate } from '../lib/format'
import type { EntryView } from '../lib/types'
import { Icon } from './Icon'
import { ActionButton, Chip, EmptyState, IconButton, Spinner } from './ui'

function DetailRow(props: {
  label: string
  value: string
  masked?: boolean
  revealed?: boolean
  onToggleReveal?: () => void
  onOpen?: () => void
}) {
  return (
    <View class="flex-row items-center gap-3 border-b border-border py-2">
      <Text class="w-20 text-xs font-medium text-muted-foreground">{props.label}</Text>
      <View class="flex-1">
        <Text class="text-xs text-foreground">
          {props.masked && !props.revealed ? '••••••••••••' : props.value}
        </Text>
      </View>
      <View class="flex-row items-center gap-0.5">
        <If when={props.masked}>
          <IconButton
            icon={props.revealed ? 'eye-off' : 'eye'}
            label={props.revealed ? t('entry.hide') : t('entry.show')}
            size={14}
            class="h-7 w-7"
            onPress={props.onToggleReveal}
          />
        </If>
        <If when={props.onOpen}>
          <IconButton
            icon="globe"
            label={t('entry.openUrl')}
            size={14}
            class="h-7 w-7"
            onPress={props.onOpen}
          />
        </If>
        <IconButton
          icon="copy"
          label={t('entry.copy')}
          size={14}
          class="h-7 w-7"
          onPress={() => void copyText(props.value)}
        />
      </View>
    </View>
  )
}

function EntryBody(props: { entry: () => EntryView; compact?: boolean }) {
  const entry = () => props.entry()
  const category = () => categories().find((item) => item.id === entry().categoryId)
  const revealed = signal(false)
  effect(() => {
    // A different entry always starts masked.
    entry().id
    revealed.set(false)
  })

  const hasFields = () =>
    Boolean(entry().username || entry().password || entry().email || entry().phone || entry().url)

  return (
    <View class="flex-1 min-h-0">
      <View class="border-b border-border bg-card px-3 py-2">
        <View class="flex-row items-start gap-3">
          <If when={props.compact}>
            <IconButton
              icon="chevron-left"
              label={t('nav.back')}
              onPress={() => selectedId.set(null)}
            />
          </If>
          <View
            class="h-8 w-9 items-center justify-center rounded-xl"
            style={{
              backgroundColor: category()?.color ? `${category()?.color}22` : token('muted'),
            }}
          >
            <Text class="text-sm">{categoryEmoji(category()?.icon)}</Text>
          </View>
          <View class="flex-1 gap-0.5">
            <View class="flex-row items-center gap-2">
              <Text
                class="flex-1 text-sm font-semibold text-foreground"
                style={{ numberOfLines: 1 }}
              >
                {entry().title}
              </Text>
              <If when={entry().archived}>
                <Text class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {t('entry.archived')}
                </Text>
              </If>
            </View>
            <Text class="text-xs text-muted-foreground">
              {category()?.name ?? t('entry.uncategorized')}
            </Text>
          </View>
          <View class="flex-row items-center gap-1">
            <IconButton
              icon={entry().favorite ? 'star-filled' : 'star'}
              label={entry().favorite ? t('entry.unstar') : t('entry.star')}
              iconColor={token(entry().favorite ? 'warning' : 'muted-foreground')}
              onPress={() => void toggleFavorite(entry())}
            />
            <If when={!entry().archived}>
              <IconButton
                icon="edit"
                label={t('entry.edit')}
                onPress={() =>
                  entryEditor.set({
                    id: entry().id,
                    categoryId: entry().categoryId ?? null,
                  })
                }
              />
            </If>
            <If when={entry().archived}>
              <IconButton
                icon="restore"
                label={t('entry.unarchive')}
                onPress={() => void unarchiveEntry(entry().id)}
              />
            </If>
            <If when={!entry().archived}>
              <IconButton
                icon="archive"
                label={t('entry.archive')}
                onPress={() =>
                  confirm.set({
                    title: t('entry.archive'),
                    message: t('entry.archiveConfirmContent'),
                    confirmLabel: t('entry.archive'),
                    destructive: false,
                    onConfirm: () => void archiveEntry(entry().id),
                  })
                }
              />
            </If>
            <IconButton
              icon="trash"
              label={t('entry.delete')}
              onPress={() =>
                confirm.set({
                  title: t('entry.delete'),
                  message: t('entry.deleteConfirm'),
                  confirmLabel: t('common.delete'),
                  destructive: true,
                  onConfirm: () => void deleteEntry(entry().id),
                })
              }
            />
          </View>
        </View>

        <If when={entry().tags.length > 0}>
          <View class="mt-2 flex-row flex-wrap items-center gap-1.5">
            <Each of={entry().tags} key={(tag) => tag}>
              {(tag) => (
                <Chip
                  label={`#${tag()}`}
                  onPress={() => {
                    setTagFilter(tag())
                    if (props.compact) selectedId.set(null)
                  }}
                />
              )}
            </Each>
          </View>
        </If>
      </View>

      <Scroll class="flex-1" contentClass="p-3 gap-3">
        <View class="rounded-xl border border-border bg-card p-3">
          <If when={hasFields()}>
            <If when={Boolean(entry().username)}>
              <DetailRow label={t('entry.username')} value={entry().username} />
            </If>
            <If when={Boolean(entry().password)}>
              <DetailRow
                label={t('entry.password')}
                value={entry().password}
                masked
                revealed={revealed()}
                onToggleReveal={() => revealed.update((value) => !value)}
              />
            </If>
            <If when={Boolean(entry().email)}>
              <DetailRow label={t('entry.email')} value={entry().email} />
            </If>
            <If when={Boolean(entry().phone)}>
              <DetailRow label={t('entry.phone')} value={entry().phone} />
            </If>
            <If when={Boolean(entry().url)}>
              <DetailRow
                label={t('entry.url')}
                value={entry().url ?? ''}
                onOpen={() => void openExternal(entry().url ?? '')}
              />
            </If>
          </If>
          <If when={!hasFields()}>
            <Text class="text-xs text-muted-foreground">{t('entry.noFields')}</Text>
          </If>
        </View>

        <View class="gap-2">
          <Text class="text-xs font-medium text-muted-foreground">{t('entry.notes')}</Text>
          <View class="rounded-xl border border-border bg-card p-3">
            <If when={entry().notes.trim().length > 0}>
              <TextView
                markdown={entry().notes}
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
            <If when={entry().notes.trim().length === 0}>
              <Text class="text-xs text-muted-foreground">{t('entry.noNotes')}</Text>
            </If>
          </View>
        </View>

        <View class="flex-row flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
          <View class="gap-0.5">
            <Text class="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('entry.created')}
            </Text>
            <Text class="text-xs text-foreground">{formatDate(entry().createdAt, true)}</Text>
          </View>
          <View class="gap-0.5">
            <Text class="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('entry.updated')}
            </Text>
            <Text class="text-xs text-foreground">{formatDate(entry().updatedAt, true)}</Text>
          </View>
        </View>
      </Scroll>
    </View>
  )
}

export function EntryDetail(props: { compact?: boolean }) {
  return (
    <View class="flex-1 min-h-0">
      <If when={detailBusy()}>
        <View class="flex-1 items-center justify-center">
          <Spinner label={t('common.loading')} />
        </View>
      </If>
      <If when={detailBusy() ? null : selected()}>
        {(entry) => <EntryBody entry={entry} compact={props.compact} />}
      </If>
      <If when={!detailBusy() && !selected()}>
        <EmptyDetail />
      </If>
    </View>
  )
}

export function EmptyDetail() {
  return (
    <EmptyState icon="shield" title={t('entry.noSelection')} hint={t('entry.noSelectionHint')} />
  )
}
