<template>
  <section class="center-block player-section-shell">
    <div class="center-block-head">
      <div>
        <p class="section-kicker">Streaming Player</p>
        <h2>{{ localize("实时播放链路", "Realtime Playback Chain") }}</h2>
      </div>
      <span class="badge">{{
        localize("录音实时流", "Recorder Live Stream")
      }}</span>
    </div>
    <p class="field-note">
      {{
        localize(
          "复用录音实时流，验证播放器缓存、重播和状态同步。",
          "Reuses the recorder's live stream to validate buffering, replay, and state sync."
        )
      }}
    </p>
    <StreamingPlayerDemo
      :locale="locale"
      :recorder="recorder"
      :source-name="localize('录音实时流', 'Recorder Live Stream')"
    />
  </section>
</template>

<script lang="ts" setup>
import StreamingPlayerDemo from "../StreamingPlayerDemo.vue"

type SupportedLocale = "zh-CN" | "en-US"

interface RecorderLike {
  on(event: "plugin:stream", handler: (event: unknown) => void): () => void
}

interface PlaygroundStreamingPlayerPanelProps {
  locale: SupportedLocale
  recorder: RecorderLike | null
  localize: (zhText: string, enText: string) => string
}

const props = defineProps<PlaygroundStreamingPlayerPanelProps>()

function localize(zhText: string, enText: string): string {
  return props.localize(zhText, enText)
}
</script>
