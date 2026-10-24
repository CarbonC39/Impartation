import { CloseCode, type Room } from '@colyseus/sdk';
import type { SpaceProtocol } from '@impartation/shared';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/** Retire a Room without letting a scheduled SDK retry resurrect its seat after navigation. */
export function leaveConnection(room: Room<SpaceProtocol>) {
  room.reconnection.enabled = false;
  room.reconnection.maxRetries = 0;
  // SDK 0.18 may already have scheduled one attempt. Release it if that attempt succeeds.
  room.onReconnect.once(() => { void room.leave().catch(() => {}); });
  if (room.connection.isOpen) void room.leave().catch(() => {});
}

/** Detect a half-open socket too: WebSocket.close alone cannot detect a silent server. */
export function watchConnection(room: Room<SpaceProtocol>, hooks: {
  dropped(): void;
  recovered(): void;
  left(code: number): void;
}) {
  let stopped = false;
  let pendingSince: number | undefined;
  let probeGeneration = 0;
  let reconnectingSince: number | undefined;
  const resetProbe = () => { pendingSince = undefined; probeGeneration++; };
  const dropped = () => { reconnectingSince ??= performance.now(); resetProbe(); hooks.dropped(); };
  const recovered = () => { reconnectingSince = undefined; resetProbe(); hooks.recovered(); };
  const left = (code: number) => { stop(); hooks.left(code); };
  room.onDrop(dropped);
  room.onReconnect(recovered);
  room.onLeave(left);
  const timer = window.setInterval(() => {
    if (stopped) return;
    if (room.reconnection.isReconnecting) {
      // A TCP socket can stay CONNECTING forever without consuming SDK retries.
      if (reconnectingSince !== undefined && performance.now() - reconnectingSince >= 30_000) {
        room.reconnection.maxRetries = 0;
        room.connection.close(CloseCode.MAY_TRY_RECONNECT, 'Reconnection timed out');
      }
      return;
    }
    if (pendingSince !== undefined) {
      if (performance.now() - pendingSince < 12_000) return;
      resetProbe();
      // Use the SDK's retryable close path, preserving its token and Room callbacks.
      room.connection.close(CloseCode.MAY_TRY_RECONNECT, 'Server heartbeat timed out');
      return;
    }
    pendingSince = performance.now();
    const generation = probeGeneration;
    room.ping(() => { if (!stopped && generation === probeGeneration) pendingSince = undefined; });
  }, 3000);
  function stop() {
    if (stopped) return;
    stopped = true;
    resetProbe();
    window.clearInterval(timer);
    room.onDrop.remove(dropped);
    room.onReconnect.remove(recovered);
    room.onLeave.remove(left);
  }
  return stop;
}
