import { describe, it, expect } from 'vitest';
import { SpatialGrid, CellState } from './spatial-grid.js';

describe('SpatialGrid', () => {
  it('should activate cells near focus point', () => {
    const grid = new SpatialGrid(10, 25);
    const events = grid.updateFocus(0, 0);

    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => e.type === 'activate')).toBe(true);
    expect(grid.activeCellCount).toBeGreaterThan(0);
  });

  it('should assign entities to cells by position', () => {
    const grid = new SpatialGrid(10, 100);
    grid.updateFocus(0, 0);

    grid.updateEntity(1, 5, 5);
    grid.updateEntity(2, 15, 15);
    grid.updateEntity(3, 5, 8);

    const cell00 = grid.getCell(0, 0);
    expect(cell00?.entities.has(1)).toBe(true);
    expect(cell00?.entities.has(3)).toBe(true);

    const cell11 = grid.getCell(1, 1);
    expect(cell11?.entities.has(2)).toBe(true);
  });

  it('should move entity between cells when position changes', () => {
    const grid = new SpatialGrid(10, 100);
    grid.updateFocus(0, 0);

    grid.updateEntity(1, 5, 5);
    expect(grid.getCell(0, 0)?.entities.has(1)).toBe(true);

    grid.updateEntity(1, 15, 5);
    expect(grid.getCell(0, 0)?.entities.has(1)).toBe(false);
    expect(grid.getCell(1, 0)?.entities.has(1)).toBe(true);
  });

  it('should deactivate cells when focus moves away', () => {
    const grid = new SpatialGrid(10, 15);
    grid.updateFocus(0, 0);
    const initialActive = grid.activeCellCount;

    const events = grid.updateFocus(200, 200);
    const deactivations = events.filter(e => e.type === 'deactivate');
    expect(deactivations.length).toBeGreaterThan(0);
  });

  it('should report active entities', () => {
    const grid = new SpatialGrid(10, 50);
    grid.updateFocus(0, 0);

    grid.updateEntity(1, 0, 0);
    grid.updateEntity(2, 5, 5);
    grid.updateEntity(3, 500, 500);

    const active = grid.getActiveEntities();
    expect(active).toContain(1);
    expect(active).toContain(2);
    expect(active).not.toContain(3);
  });

  it('should remove entities', () => {
    const grid = new SpatialGrid(10, 50);
    grid.updateFocus(0, 0);
    grid.updateEntity(1, 5, 5);
    expect(grid.trackedEntityCount).toBe(1);

    grid.removeEntity(1);
    expect(grid.trackedEntityCount).toBe(0);
  });
});
