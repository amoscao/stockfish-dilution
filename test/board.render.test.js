// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest';
import { createBoard } from '../src/board.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function squareCenter(square) {
  const fileIndex = FILES.indexOf(square[0]);
  const rankIndex = 8 - Number(square[1]);
  return {
    clientX: fileIndex * 100 + 50,
    clientY: rankIndex * 100 + 50
  };
}

function dispatchPointer(target, type, init = {}) {
  const EventCtor = window.PointerEvent || window.MouseEvent;
  const event = new EventCtor(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 0,
    clientY: 0,
    ...init
  });

  if (!('pointerId' in event)) {
    Object.defineProperty(event, 'pointerId', {
      configurable: true,
      value: init.pointerId ?? 1
    });
  }

  if (!('pointerType' in event)) {
    Object.defineProperty(event, 'pointerType', {
      configurable: true,
      value: init.pointerType ?? 'mouse'
    });
  }

  target.dispatchEvent(event);
}

function makeBoard({
  position = {},
  selectableSquares = new Set(),
  legalTargetsBySquare = {},
  interactionEnabled = false
} = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 800,
    bottom: 800,
    width: 800,
    height: 800
  });
  const onHumanMoveAttempt = vi.fn();
  const board = createBoard({
    container,
    onHumanMoveAttempt
  });

  board.setMoveQueryHandlers({
    canSelectSquare: (square) => selectableSquares.has(square),
    getLegalTargets: (square) => legalTargetsBySquare[square] || []
  });
  board.setInteractionEnabled(interactionEnabled);
  board.render(position, 'w');

  return { board, container, onHumanMoveAttempt };
}

describe('board blind marker rendering', () => {
  test('renders marker only on selected occupied squares when visible', () => {
    const { board, container } = makeBoard();

    board.setBlindMarkers({ squares: ['e4', 'a1'], visible: true });
    board.render({ e4: { color: 'w', type: 'p' } }, 'w');

    expect(container.querySelectorAll('.blind-marker')).toHaveLength(1);
    expect(container.querySelector('[data-square="e4"] .blind-marker')).not.toBeNull();
    expect(container.querySelector('[data-square="a1"] .blind-marker')).toBeNull();
  });

  test('does not render markers when hidden', () => {
    const { board, container } = makeBoard();

    board.setBlindMarkers({ squares: ['e4'], visible: false });
    board.render({ e4: { color: 'w', type: 'p' } }, 'w');

    expect(container.querySelectorAll('.blind-marker')).toHaveLength(0);
  });

  test('updates marker set across re-renders', () => {
    const { board, container } = makeBoard();

    board.setBlindMarkers({ squares: ['e4'], visible: true });
    board.render({ e4: { color: 'w', type: 'p' }, d4: { color: 'b', type: 'p' } }, 'w');
    expect(container.querySelector('[data-square="e4"] .blind-marker')).not.toBeNull();

    board.setBlindMarkers({ squares: ['d4'], visible: true });
    board.render({ e4: { color: 'w', type: 'p' }, d4: { color: 'b', type: 'p' } }, 'w');

    expect(container.querySelector('[data-square="e4"] .blind-marker')).toBeNull();
    expect(container.querySelector('[data-square="d4"] .blind-marker')).not.toBeNull();
  });
});

describe('board interactions', () => {
  test('submits a move when a legal drag ends on a legal square', () => {
    const { container, onHumanMoveAttempt } = makeBoard({
      position: { e2: { color: 'w', type: 'p' } },
      selectableSquares: new Set(['e2']),
      legalTargetsBySquare: { e2: ['e3', 'e4'] },
      interactionEnabled: true
    });

    const sourcePiece = container.querySelector('[data-square="e2"] .piece');
    const sourceCenter = squareCenter('e2');
    const targetCenter = squareCenter('e4');

    dispatchPointer(sourcePiece, 'pointerdown', sourceCenter);
    dispatchPointer(window, 'pointermove', targetCenter);

    expect(container.querySelector('.drag-piece-preview')).not.toBeNull();
    expect(container.querySelector('[data-square="e4"]').classList.contains('drag-hover')).toBe(true);

    dispatchPointer(window, 'pointerup', targetCenter);

    expect(onHumanMoveAttempt).toHaveBeenCalledTimes(1);
    expect(onHumanMoveAttempt).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });
    expect(container.querySelector('.drag-piece-preview')).toBeNull();
  });

  test('cancels dragging cleanly when dropped outside the board', () => {
    const { container, onHumanMoveAttempt } = makeBoard({
      position: { e2: { color: 'w', type: 'p' } },
      selectableSquares: new Set(['e2']),
      legalTargetsBySquare: { e2: ['e3', 'e4'] },
      interactionEnabled: true
    });

    const sourcePiece = container.querySelector('[data-square="e2"] .piece');
    const sourceCenter = squareCenter('e2');

    dispatchPointer(sourcePiece, 'pointerdown', sourceCenter);
    dispatchPointer(window, 'pointermove', {
      clientX: sourceCenter.clientX,
      clientY: sourceCenter.clientY - 100
    });
    dispatchPointer(window, 'pointerup', { clientX: 900, clientY: 900 });

    expect(onHumanMoveAttempt).not.toHaveBeenCalled();
    expect(container.querySelector('.drag-piece-preview')).toBeNull();
    expect(container.querySelectorAll('.legal-dot')).toHaveLength(0);
  });

  test('ignores dragging when interaction is disabled or the piece cannot be selected', () => {
    const disabledBoard = makeBoard({
      position: { e2: { color: 'w', type: 'p' } },
      selectableSquares: new Set(['e2']),
      legalTargetsBySquare: { e2: ['e3', 'e4'] },
      interactionEnabled: false
    });
    const disabledPiece = disabledBoard.container.querySelector('[data-square="e2"] .piece');
    const sourceCenter = squareCenter('e2');
    const targetCenter = squareCenter('e4');

    dispatchPointer(disabledPiece, 'pointerdown', sourceCenter);
    dispatchPointer(window, 'pointermove', targetCenter);
    dispatchPointer(window, 'pointerup', targetCenter);

    expect(disabledBoard.onHumanMoveAttempt).not.toHaveBeenCalled();
    expect(disabledBoard.container.querySelector('.drag-piece-preview')).toBeNull();

    const unselectableBoard = makeBoard({
      position: { e2: { color: 'b', type: 'p' } },
      selectableSquares: new Set(),
      legalTargetsBySquare: { e2: ['e3', 'e4'] },
      interactionEnabled: true
    });
    const unselectablePiece = unselectableBoard.container.querySelector('[data-square="e2"] .piece');

    dispatchPointer(unselectablePiece, 'pointerdown', sourceCenter);
    dispatchPointer(window, 'pointermove', targetCenter);
    dispatchPointer(window, 'pointerup', targetCenter);

    expect(unselectableBoard.onHumanMoveAttempt).not.toHaveBeenCalled();
    expect(unselectableBoard.container.querySelector('.drag-piece-preview')).toBeNull();
  });

  test('keeps click-to-move working after the drag refactor', () => {
    const { container, onHumanMoveAttempt } = makeBoard({
      position: { e2: { color: 'w', type: 'p' } },
      selectableSquares: new Set(['e2']),
      legalTargetsBySquare: { e2: ['e3', 'e4'] },
      interactionEnabled: true
    });

    container.querySelector('[data-square="e2"]').click();
    expect(container.querySelectorAll('.legal-dot')).toHaveLength(2);

    container.querySelector('[data-square="e4"]').click();

    expect(onHumanMoveAttempt).toHaveBeenCalledTimes(1);
    expect(onHumanMoveAttempt).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });
  });

  test('allows click-to-move immediately after completing a drag', () => {
    const { container, onHumanMoveAttempt } = makeBoard({
      position: {
        e2: { color: 'w', type: 'p' },
        g1: { color: 'w', type: 'n' }
      },
      selectableSquares: new Set(['e2', 'g1']),
      legalTargetsBySquare: {
        e2: ['e3', 'e4'],
        g1: ['f3', 'h3']
      },
      interactionEnabled: true
    });

    const sourcePiece = container.querySelector('[data-square="e2"] .piece');
    const sourceCenter = squareCenter('e2');
    const dragTargetCenter = squareCenter('e4');

    dispatchPointer(sourcePiece, 'pointerdown', sourceCenter);
    dispatchPointer(window, 'pointermove', dragTargetCenter);
    dispatchPointer(window, 'pointerup', dragTargetCenter);

    expect(onHumanMoveAttempt).toHaveBeenCalledTimes(1);
    expect(onHumanMoveAttempt).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });

    const followupPiece = container.querySelector('[data-square="g1"] .piece');
    const followupSquare = container.querySelector('[data-square="g1"]');
    const followupCenter = squareCenter('g1');

    dispatchPointer(followupPiece, 'pointerdown', followupCenter);
    followupSquare.click();

    expect(container.querySelectorAll('.legal-dot')).toHaveLength(2);
    expect(container.querySelector('[data-square="g1"]').classList.contains('selected')).toBe(true);
  });
});
