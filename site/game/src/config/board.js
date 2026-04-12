import { ARENA_HEIGHT, ARENA_WIDTH } from "./balance.js";

export const BOARD_ROWS = 5;
export const BOARD_COLS = 7;
export const CELL_WIDTH = 90;
export const CELL_HEIGHT = 72;

export const BOARD_LEFT = 184;
export const BOARD_TOP = 96;
export const BOARD_WIDTH = BOARD_COLS * CELL_WIDTH;
export const BOARD_HEIGHT = BOARD_ROWS * CELL_HEIGHT;
export const BOARD_RIGHT = BOARD_LEFT + BOARD_WIDTH;
export const BOARD_BOTTOM = BOARD_TOP + BOARD_HEIGHT;

export const WALL_X = 124;
export const BREACH_X = BOARD_LEFT - 36;
export const ENEMY_SPAWN_X = BOARD_RIGHT + 56;

export const BOARD_CENTER_X = ARENA_WIDTH / 2;
export const BOARD_CENTER_Y = ARENA_HEIGHT / 2;

export function getCellCenter(row, col) {
  return {
    x: BOARD_LEFT + col * CELL_WIDTH + CELL_WIDTH / 2,
    y: BOARD_TOP + row * CELL_HEIGHT + CELL_HEIGHT / 2,
  };
}

export function getLaneY(row) {
  return getCellCenter(row, 0).y;
}

export function getTileAtPoint(x, y) {
  const col = Math.floor((x - BOARD_LEFT) / CELL_WIDTH);
  const row = Math.floor((y - BOARD_TOP) / CELL_HEIGHT);

  if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) {
    return null;
  }

  return { row, col };
}
