import { computed, Text, token, View } from 'nsh'
import { Button, Menu, MenuItem, MenuSeparator } from 'nsh/base'
import { t } from 'nsh/i18n'

import { presets } from '../lib/state'

import { Icon } from './Icon'

/** “从预设添加”触发器：始终显示占位文案，不选中任何预设。 */
export function PresetPicker(props: { type: string; onPick: (value: string) => void }) {
  const matching = computed(() => presets().filter((preset) => preset.fieldType === props.type))

  const trigger = (
    <Button
      class="h-8 w-full flex-row items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 hover:bg-accent"
      accessibilityLabel={t('preset.choose')}
    >
      <Text class="flex-1 text-xs text-muted-foreground" style={{ numberOfLines: 1 }}>
        {t('preset.choose')}
      </Text>
      <Icon name="chevron-down" size={12} color={token('muted-foreground')} />
    </Button>
  )

  return (
    <View class="w-full">
      <Menu
        placement="bottom"
        align="start"
        offset={4}
        popupClass="rounded-md border border-border bg-popover p-1 shadow-lg"
        popupStyle={{ maxWidth: 360 }}
        trigger={trigger}
      >
        <Each of={matching()} key={(preset) => preset.id}>
          {(preset, index) => (
            <>
              <If when={index() > 0}>
                <MenuSeparator class="my-1 h-px bg-border" />
              </If>
              <MenuItem
                class="min-w-[180px] max-w-[340px] gap-0.5 rounded px-2 py-1.5 hover:bg-accent"
                accessibilityLabel={preset().value}
                onSelect={() => props.onPick(preset().id)}
              >
                <View class="gap-0.5">
                  <Text class="text-xs text-popover-foreground" style={{ maxWidth: 320 }}>
                    {preset().value}
                  </Text>
                  <If when={preset().label.trim().length > 0}>
                    <Text class="text-[11px] text-muted-foreground">{preset().label}</Text>
                  </If>
                </View>
              </MenuItem>
            </>
          )}
        </Each>
      </Menu>
    </View>
  )
}
