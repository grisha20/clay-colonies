import { WebSocket, WebSocketServer } from "ws";
import type { NetworkViewState, NetworkWorldSnapshot, ZoneType } from "../../../shared/types";
import { CONFIG } from "../config";

export type ClientCommand =
  | {
      type: "dropFood";
      x: number;
      y: number;
    }
  | {
      type: "paintZone";
      zone: ZoneType;
      cells: number[];
      colonyIndex: number;
    }
  | {
      type: "eraseZone";
      cells: number[];
      colonyIndex: number;
    }
  | {
      type: "placeBuilding";
      building: "hut" | "storage" | "idol";
      x: number;
      y: number;
      colonyIndex: number;
    }
  | {
      type: "paintWall";
      cells: number[];
      colonyIndex: number;
    }
  | {
      type: "eraseBuild";
      cells: number[];
      colonyIndex: number;
    }
  | {
      type: "setPriorities";
      colonyIndex: number;
      priorities: { clay: number; wood: number; stone: number; build: number; guard: number };
    }
  | {
      type: "setSpeed";
      value: number;
    }
  | {
      type: "setView";
      mode: NetworkViewState["mode"];
      undergroundColonyIndex: number;
    }
  | {
      type: "saveOffsetSettings";
      settings: any;
    };

export type SocketHub = {
  broadcast(snapshotForView: (view: NetworkViewState) => NetworkWorldSnapshot): void;
  close(): void;
};

const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

function parseCommand(raw: string): ClientCommand | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object") {
      return null;
    }

    const command = value as Record<string, unknown>;
    // Каким племенем управляет клиент (горячая смена A/B до настоящего playerId).
    const colonyIndex =
      typeof command.colony === "number" && Number.isFinite(command.colony)
        ? Math.max(0, Math.min(1, Math.floor(command.colony)))
        : 0;
    if (command.type === "setSpeed" && typeof command.value === "number" && Number.isFinite(command.value)) {
      return {
        type: "setSpeed",
        value: command.value
      };
    }

    if (command.type === "setView") {
      const mode = command.mode === "underground" ? "underground" : command.mode === "surface" ? "surface" : null;
      const undergroundColonyIndex = typeof command.undergroundColonyIndex === "number" && Number.isFinite(command.undergroundColonyIndex)
        ? Math.max(0, Math.min(1, Math.floor(command.undergroundColonyIndex)))
        : 0;
      if (!mode) {
        return null;
      }
      return {
        type: "setView",
        mode,
        undergroundColonyIndex
      };
    }

    if (command.type === "setPriorities") {
      const raw = (command.priorities ?? {}) as Record<string, unknown>;
      const clampWeight = (value: unknown): number =>
        typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(5, Math.floor(value))) : 1;
      return {
        type: "setPriorities",
        colonyIndex,
        priorities: {
          clay: clampWeight(raw.clay),
          wood: clampWeight(raw.wood),
          stone: clampWeight(raw.stone),
          build: clampWeight(raw.build),
          guard: clampWeight(raw.guard)
        }
      };
    }

    if (command.type === "placeBuilding") {
      if (
        (command.building !== "hut" && command.building !== "storage" && command.building !== "idol") ||
        typeof command.x !== "number" ||
        typeof command.y !== "number" ||
        !Number.isFinite(command.x) ||
        !Number.isFinite(command.y) ||
        command.x < 0 ||
        command.y < 0 ||
        command.x >= CONFIG.mapWidth ||
        command.y >= CONFIG.mapHeight
      ) {
        return null;
      }
      return { type: "placeBuilding", building: command.building, x: command.x, y: command.y, colonyIndex };
    }

    if (command.type === "paintWall" || command.type === "eraseBuild") {
      const rawCells = Array.isArray(command.cells) ? (command.cells as unknown[]) : [];
      const cells: number[] = [];
      for (const cell of rawCells.slice(0, 512)) {
        if (typeof cell === "number" && Number.isInteger(cell) && cell >= 0) {
          cells.push(cell);
        }
      }
      if (cells.length === 0) {
        return null;
      }
      return command.type === "paintWall" ? { type: "paintWall", cells, colonyIndex } : { type: "eraseBuild", cells, colonyIndex };
    }

    if (command.type === "paintZone" || command.type === "eraseZone") {
      const rawCells = Array.isArray(command.cells) ? (command.cells as unknown[]) : [];
      const cells: number[] = [];
      for (const cell of rawCells.slice(0, 4096)) {
        if (typeof cell === "number" && Number.isInteger(cell) && cell >= 0) {
          cells.push(cell);
        }
      }
      if (cells.length === 0) {
        return null;
      }
      if (command.type === "paintZone") {
        const zone = command.zone === "harvest" ? "harvest" : command.zone === "forbid" ? "forbid" : null;
        if (!zone) {
          return null;
        }
        return { type: "paintZone", zone, cells, colonyIndex };
      }
      return { type: "eraseZone", cells, colonyIndex };
    }

    if (command.type === "dropFood" && typeof command.x === "number" && typeof command.y === "number") {
      if (
        !Number.isFinite(command.x) ||
        !Number.isFinite(command.y) ||
        command.x < 0 ||
        command.y < 0 ||
        command.x >= CONFIG.mapWidth ||
        command.y >= CONFIG.mapHeight
      ) {
        return null;
      }

      return {
        type: "dropFood",
        x: command.x,
        y: command.y
      };
    }

    if (command.type === "saveOffsetSettings" && command.settings && typeof command.settings === "object") {
      return {
        type: "saveOffsetSettings",
        settings: command.settings
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function createSocketHub(
  port: number,
  getSnapshot: (view: NetworkViewState, includePheromones: boolean) => NetworkWorldSnapshot,
  onCommand: (command: ClientCommand) => void = () => {}
): SocketHub {
  const server = new WebSocketServer({ port });
  const clients = new Map<WebSocket, NetworkViewState>();

  server.on("connection", (socket) => {
    const initialView: NetworkViewState = { mode: "surface", undergroundColonyIndex: 0 };
    clients.set(socket, initialView);
    socket.send(JSON.stringify(getSnapshot(initialView, true)));

    socket.on("close", () => {
      clients.delete(socket);
    });

    socket.on("message", (data) => {
      const command = parseCommand(String(data));
      if (command) {
        if (command.type === "setView") {
          clients.set(socket, {
            mode: command.mode,
            undergroundColonyIndex: command.undergroundColonyIndex
          });
          socket.send(JSON.stringify(getSnapshot(clients.get(socket)!, false)));
          return;
        }
        onCommand(command);
      }
    });
  });

  console.log(`WebSocket server listening on ws://localhost:${port}`);

  return {
    broadcast(snapshotForView) {
      const messages = new Map<string, string>();
      for (const [client, view] of clients) {
        if (client.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > MAX_BUFFERED_BYTES) {
            continue;
          }
          const key = `${view.mode}:${view.undergroundColonyIndex}`;
          let message = messages.get(key);
          if (!message) {
            message = JSON.stringify(snapshotForView(view));
            messages.set(key, message);
          }
          client.send(message);
        }
      }
    },
    close() {
      server.close();
    }
  };
}
