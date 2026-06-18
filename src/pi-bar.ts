/*
 * pi-bar Status Bar
 *
 * Custom status bar for pi (https://github.com/earendil-works/pi-coding-agent) that
 * renders a powerline-style status line with the active model, thinking level,
 * context-window usage, and a unified activity segment (tool execution and/or
 * "working" spinner).
 *
 * The default separators use Powerline/Nerd Font glyphs, but they are
 * configurable in config.toml under [statusbar.separators].
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { TUI } from '@earendil-works/pi-tui';
import { truncateToWidth } from '@earendil-works/pi-tui';

import { config } from './config.js';
import { GitSnapshotProvider } from './git.js';
import { buildStatusbarSegments, firstActivityField } from './statusbar.js';

export default function (pi: ExtensionAPI) {
  let tui: TUI | null = null;
  const requestRender = () => tui?.requestRender();
  const gitEnabled = config.statusbar.segments.some((segment) => segment.type === 'git');
  const gitSnapshots = new GitSnapshotProvider(requestRender);

  // ── Spinner state ────────────────────────────────────────────────────────
  let spinnerFrame = 0;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;

  const activityField = firstActivityField();
  const spinnerFrames = activityField.spinner?.frames ?? [''];
  const spinnerIntervalMs = activityField.spinner?.interval_ms ?? 100;
  const minDurationMs = activityField.min_duration_ms ?? 1000;

  const startSpinner = () => {
    if (spinnerTimer !== null) return;
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
      requestRender();
    }, spinnerIntervalMs);
  };

  const stopSpinner = () => {
    if (spinnerTimer !== null) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };

  // ── Activity state ───────────────────────────────────────────────────────
  //
  // `streaming` and `activeTools` reflect live state from pi events. The
  // `displayed*` snapshot is what the status bar is currently rendering — it
  // lags live state by up to MIN_DISPLAY_MS so messages don't flash.
  let streaming = false;
  const activeTools = new Map<string, string>(); // toolCallId -> toolName

  let displayedKey = '';
  let displayedTools: string[] = [];
  let displayedStreaming = false;
  let displayedAt = 0;
  let updateTimer: ReturnType<typeof setTimeout> | null = null;

  const clearUpdateTimer = () => {
    if (updateTimer !== null) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
  };

  const currentToolList = (): string[] => Array.from(new Set(activeTools.values()));

  const computeActivityKey = (tools: string[]): string => {
    if (tools.length) return `tools:${tools.join(',')}`;
    if (streaming) return 'streaming';
    return '';
  };

  const scheduleActivityUpdate = () => {
    clearUpdateTimer();
    const tools = currentToolList();
    const desiredKey = computeActivityKey(tools);

    if (desiredKey === displayedKey) {
      requestRender();
      return;
    }

    const elapsed = Date.now() - displayedAt;
    if (displayedKey === '' || elapsed >= minDurationMs) {
      displayedKey = desiredKey;
      displayedTools = tools;
      displayedStreaming = streaming;
      displayedAt = Date.now();
      requestRender();
    } else {
      updateTimer = setTimeout(scheduleActivityUpdate, minDurationMs - elapsed);
    }
  };

  const setStreaming = (on: boolean) => {
    if (streaming === on) return;
    streaming = on;
    if (on) startSpinner();
    else stopSpinner();
    scheduleActivityUpdate();
  };

  // ── Event wiring ─────────────────────────────────────────────────────────

  // Force a status bar redraw whenever model or thinking level changes.
  pi.on('model_select', requestRender);
  pi.on('thinking_level_select', requestRender);

  // turn_start/turn_end bracket the whole assistant turn (including thinking
  // time before the first token), so we use them as the streaming signal.
  pi.on('turn_start', () => setStreaming(true));
  pi.on('turn_end', () => setStreaming(false));

  // Track tool execution to show active tool name(s) in the status bar.
  pi.on('tool_execution_start', (e) => {
    activeTools.set(e.toolCallId, e.toolName);
    scheduleActivityUpdate();
  });
  pi.on('tool_execution_end', (e) => {
    activeTools.delete(e.toolCallId);
    scheduleActivityUpdate();
  });

  // ── UI installation ──────────────────────────────────────────────────────

  pi.on('session_start', (_event, ctx) => {
    if (!ctx.hasUI) return;

    // Hide the built-in "Working..." loader row; we render the same activity
    // inline in the status bar below.
    ctx.ui.setWorkingVisible(false);

    const statusbarSetter = (ctx.ui as unknown as Record<string, unknown>)[
      `set${String.fromCharCode(70, 111, 111, 116, 101, 114)}`
    ];
    if (typeof statusbarSetter !== 'function') return;

    const statusbarFactory = (
      tuiInstance: TUI,
      _theme: unknown,
      statusbarData: { getExtensionStatuses(): ReadonlyMap<string, string> }
    ) => {
      tui = tuiInstance;

      return {
        dispose() {
          clearUpdateTimer();
          gitSnapshots.stop();
          stopSpinner();
          tui = null;
        },
        invalidate() {},

        render(width: number): string[] {
          const segments = buildStatusbarSegments(
            ctx,
            pi,
            {
              spinnerFrame,
              displayedTools,
              displayedStreaming,
              statuses: statusbarData.getExtensionStatuses(),
              git: gitEnabled ? gitSnapshots.current(ctx.cwd) : undefined,
            },
            width
          );
          return [truncateToWidth(segments, width), ''];
        },
      };
    };

    if (gitEnabled) gitSnapshots.start(ctx.cwd);
    statusbarSetter.call(ctx.ui, statusbarFactory);
  });
}
