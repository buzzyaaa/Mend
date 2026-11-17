import { signal, Text, View, windowSize } from 'nsh'
import { Dialog } from 'nsh/base'
import { t } from 'nsh/i18n'

import { errorText } from '../lib/errors'
import * as native from '../lib/native'
import {
  ActionButton,
  Field,
  IconButton,
  SwitchField,
  TextField,
  MODAL_BACKDROP_CLASS,
  MODAL_CLASS,
  ModalFrame,
} from './ui'

/** 独立的密码生成器弹窗；与条目编辑表单解耦，只把结果通过 onUse 交回。 */
export function GeneratorDialog(props: {
  open: boolean
  onClose: () => void
  onUse: (password: string) => void
}) {
  const generated = signal('')
  const generatorError = signal('')
  const lengthInput = signal('16')
  const generator = signal({
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
  })

  function normalizeLength() {
    const digits = lengthInput().replace(/\D/g, '').slice(0, 2)
    const parsed = digits ? Number(digits) : 16
    const length = Math.min(64, Math.max(6, parsed))
    lengthInput.set(String(length))
    return length
  }

  function generate() {
    generatorError.set('')
    try {
      generated.set(
        native.generatePassword({ length: normalizeLength(), ...generator() }),
      )
    } catch (cause) {
      generatorError.set(errorText(cause))
    }
  }

  function useGenerated() {
    if (!generated()) return
    props.onUse(generated())
    props.onClose()
  }

  return (
    <Dialog
      open={props.open}
      closeOnBackdropPress={false}
      onOpen={() => {
        if (!generated()) generate()
      }}
      onOpenChange={(event) => {
        if (!event.open) props.onClose()
      }}
      onCancel={props.onClose}
      animation="fade"
      accessibilityLabel={t('generator.title')}
      class={MODAL_CLASS}
      backdropClass={MODAL_BACKDROP_CLASS}
      style={{ width: 460, maxWidth: '92%' }}
    >
      <ModalFrame
        class="gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-xl"
        maxHeight={Math.max(360, windowSize().height - 80)}
      >
        <View class="flex-row items-start gap-3">
          <View class="flex-1 gap-0.5">
            <Text class="text-sm font-semibold text-foreground">{t('generator.title')}</Text>
            <Text class="text-xs text-muted-foreground">{t('generator.hint')}</Text>
          </View>
          <IconButton icon="close" label={t('common.close')} onPress={props.onClose} />
        </View>

        <Field label={t('generator.length')}>
          <TextField
            value={lengthInput()}
            onChange={(value) => lengthInput.set(value.replace(/\D/g, '').slice(0, 2))}
            onBlur={normalizeLength}
            onSubmit={generate}
            maxLength={2}
            accessibilityLabel={t('generator.length')}
            class="h-8"
          />
        </Field>

        <View class="flex-row flex-wrap gap-x-6">
          <View class="w-[45%]">
            <SwitchField
              label={t('generator.uppercase')}
              checked={generator().uppercase}
              onChange={(checked) =>
                generator.update((current) => ({ ...current, uppercase: checked }))
              }
            />
          </View>
          <View class="w-[45%]">
            <SwitchField
              label={t('generator.lowercase')}
              checked={generator().lowercase}
              onChange={(checked) =>
                generator.update((current) => ({ ...current, lowercase: checked }))
              }
            />
          </View>
          <View class="w-[45%]">
            <SwitchField
              label={t('generator.digits')}
              checked={generator().digits}
              onChange={(checked) =>
                generator.update((current) => ({ ...current, digits: checked }))
              }
            />
          </View>
          <View class="w-[45%]">
            <SwitchField
              label={t('generator.symbols')}
              checked={generator().symbols}
              onChange={(checked) =>
                generator.update((current) => ({ ...current, symbols: checked }))
              }
            />
          </View>
        </View>
        <SwitchField
          label={t('generator.excludeAmbiguous')}
          checked={generator().excludeAmbiguous}
          onChange={(checked) =>
            generator.update((current) => ({ ...current, excludeAmbiguous: checked }))
          }
        />

        <View class="gap-2">
          <Field label={t('generator.result')}>
            <View
              class="flex-row items-center rounded-md border border-border bg-background px-3 py-2"
              style={{ minHeight: 36 }}
            >
              <Text class="flex-1 text-xs font-mono text-foreground">
                {generated() || t('generator.placeholder')}
              </Text>
              <ActionButton
                label={t('generator.regenerate')}
                icon="refresh"
                onPress={generate}
              />
            </View>
          </Field>
          <If when={generatorError()}>
            <Text class="text-xs text-destructive">{generatorError()}</Text>
          </If>
        </View>

        <View class="flex-row justify-end gap-2">
          <ActionButton label={t('common.cancel')} variant="ghost" onPress={props.onClose} />
          <ActionButton
            label={t('generator.fill')}
            variant="primary"
            icon="check"
            disabled={!generated()}
            onPress={useGenerated}
          />
        </View>
      </ModalFrame>
    </Dialog>
  )
}
