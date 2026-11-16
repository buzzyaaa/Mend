import { Overlay, Text, token, View } from 'nsh'
import { Progress } from 'nsh/base'
import { t } from 'nsh/i18n'

import { updateProgress, updateRunning, updateStage } from '../lib/update'

import { Icon } from './Icon'

/** 底部悬浮更新进度条：整条都穿透点击，下载/安装期间不影响任何操作。 */
export function UpdateProgressHost() {
  return (
    <If when={updateRunning()}>
      <Overlay
        style={{
          left: 0,
          right: 0,
          bottom: 16,
          alignItems: 'center',
          pointerEvents: 'box-none',
        }}
      >
        <View
          role="progressbar"
          style={{ pointerEvents: 'none' }}
          class="w-[90%] max-w-[460px] flex-row items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 shadow-lg"
        >
          <Icon name="download" size={15} color={token('foreground')} />
          <View class="flex-1 gap-1">
            <View class="flex-row items-center justify-between gap-2">
              <Text class="text-[11px] font-medium text-foreground">{t('update.running')}</Text>
              <Text class="text-[11px] text-muted-foreground">
                {updateStage() === 'install' ? t('update.installing') : t('update.downloading')}
              </Text>
            </View>
            <Progress
              value={updateProgress()}
              class="w-full"
              trackClass="h-1.5 w-full rounded-full bg-muted"
              indicatorClass="h-1.5 rounded-full bg-primary"
            />
          </View>
          <Text class="w-9 text-right text-[11px] text-muted-foreground">
            {`${updateProgress()}%`}
          </Text>
        </View>
      </Overlay>
    </If>
  )
}
