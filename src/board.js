const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

const PIECE_IMAGE_BY_CODE = {
  wp: 'w_pawn_png_128px.png',
  wn: 'w_knight_png_128px.png',
  wb: 'w_bishop_png_128px.png',
  wr: 'w_rook_png_128px.png',
  wq: 'w_queen_png_128px.png',
  wk: 'w_king_png_128px.png',
  bp: 'b_pawn_png_128px.png',
  bn: 'b_knight_png_128px.png',
  bb: 'b_bishop_png_128px.png',
  br: 'b_rook_png_128px.png',
  bq: 'b_queen_png_128px.png',
  bk: 'b_king_png_128px.png'
};

const DRAG_START_DISTANCE_PX = 6;

function squareColor(square) {
  const fileIndex = FILES.indexOf(square[0]);
  const rankNumber = Number(square[1]);
  return (fileIndex + rankNumber) % 2 === 1 ? 'dark' : 'light';
}

function squaresForOrientation(orientation) {
  const files = orientation === 'w' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'w' ? [...RANKS].reverse() : RANKS;

  const squares = [];
  for (const rank of ranks) {
    for (const file of files) {
      squares.push(`${file}${rank}`);
    }
  }

  return squares;
}

export function createBoard({ container, onHumanMoveAttempt }) {
  let orientation = 'w';
  let position = {};
  let interactionEnabled = false;
  let selectedSquare = null;
  let legalTargets = [];
  let getLegalTargets = () => [];
  let canSelectSquare = () => false;
  let lastMove = null;
  let kingOutcomeByColor = { w: null, b: null };
  let blindSquares = new Set();
  let showBlindMarkers = false;
  let pendingDrag = null;
  let dragState = null;
  let suppressNextClick = false;

  function distanceBetweenPoints(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getPointerPosition(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    return {
      clientX,
      clientY,
      localX: clientX - rect.left,
      localY: clientY - rect.top
    };
  }

  function squareAtClientPoint(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }

    const col = clamp(Math.floor(((clientX - rect.left) / rect.width) * 8), 0, 7);
    const row = clamp(Math.floor(((clientY - rect.top) / rect.height) * 8), 0, 7);
    const squares = squaresForOrientation(orientation);
    return squares[row * 8 + col] || null;
  }

  function cancelPendingDrag() {
    pendingDrag = null;
  }

  function stopDragging() {
    dragState = null;
  }

  function cancelActiveDrag({ rerender = true, clearHighlights = true } = {}) {
    const hadDrag = Boolean(dragState);
    cancelPendingDrag();
    stopDragging();

    if (clearHighlights) {
      clearSelection();
    }

    if (rerender && (hadDrag || clearHighlights)) {
      render(position, orientation);
    }
  }

  function beginDragging(pointerInfo) {
    dragState = {
      pointerId: pointerInfo.pointerId,
      fromSquare: pointerInfo.square,
      piece: pointerInfo.piece,
      pointerPosition: getPointerPosition(pointerInfo.clientX, pointerInfo.clientY),
      hoverSquare: squareAtClientPoint(pointerInfo.clientX, pointerInfo.clientY)
    };

    showLegalTargets(pointerInfo.square, getLegalTargets(pointerInfo.square));
  }

  function updateDragPointer(clientX, clientY) {
    if (!dragState) {
      return;
    }

    dragState.pointerPosition = getPointerPosition(clientX, clientY);
    dragState.hoverSquare = squareAtClientPoint(clientX, clientY);
    render(position, orientation);
  }

  function completeDrag(toSquare) {
    if (!dragState) {
      return;
    }

    const fromSquare = dragState.fromSquare;
    const canDrop = Boolean(toSquare) && legalTargets.includes(toSquare);
    stopDragging();
    clearSelection();
    render(position, orientation);

    if (canDrop) {
      onHumanMoveAttempt({ from: fromSquare, to: toSquare });
    }
  }

  function onPointerDown(event) {
    // A real follow-up interaction starts with a fresh pointerdown, so any
    // stale click suppression from the previous drag should not leak into it.
    suppressNextClick = false;

    if (!interactionEnabled) {
      return;
    }

    if (event.button !== 0 && event.pointerType !== 'touch') {
      return;
    }

    const pieceEl = event.target.closest('.piece');
    const squareEl = event.target.closest('.square');
    if (!pieceEl || !squareEl || !container.contains(squareEl)) {
      return;
    }

    const square = squareEl.dataset.square;
    const piece = square ? position[square] : null;
    if (!square || !piece || !canSelectSquare(square, piece)) {
      return;
    }

    pendingDrag = {
      pointerId: event.pointerId,
      square,
      piece,
      start: { x: event.clientX, y: event.clientY },
      clientX: event.clientX,
      clientY: event.clientY
    };
  }

  function onPointerMove(event) {
    if (dragState) {
      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      event.preventDefault();
      updateDragPointer(event.clientX, event.clientY);
      return;
    }

    if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) {
      return;
    }

    if (
      distanceBetweenPoints(pendingDrag.start, {
        x: event.clientX,
        y: event.clientY
      }) < DRAG_START_DISTANCE_PX
    ) {
      return;
    }

    event.preventDefault();
    const nextPendingDrag = pendingDrag;
    cancelPendingDrag();
    beginDragging({
      ...nextPendingDrag,
      clientX: event.clientX,
      clientY: event.clientY
    });
  }

  function onPointerUp(event) {
    if (dragState && event.pointerId === dragState.pointerId) {
      event.preventDefault();
      suppressNextClick = true;
      const dropSquare = squareAtClientPoint(event.clientX, event.clientY);
      completeDrag(dropSquare);
      return;
    }

    if (pendingDrag && event.pointerId === pendingDrag.pointerId) {
      cancelPendingDrag();
    }
  }

  function onPointerCancel(event) {
    if (dragState && event.pointerId === dragState.pointerId) {
      suppressNextClick = true;
      cancelActiveDrag();
      return;
    }

    if (pendingDrag && event.pointerId === pendingDrag.pointerId) {
      cancelPendingDrag();
    }
  }

  function setMoveQueryHandlers(handlers) {
    getLegalTargets = handlers.getLegalTargets;
    canSelectSquare = handlers.canSelectSquare;
  }

  function clearSelection() {
    selectedSquare = null;
    legalTargets = [];
  }

  function showLegalTargets(square, targets) {
    selectedSquare = square;
    legalTargets = targets;
    render(position, orientation);
  }

  function clearLegalTargets() {
    clearSelection();
    render(position, orientation);
  }

  function setInteractionEnabled(enabled) {
    interactionEnabled = enabled;
    if (!enabled) {
      cancelActiveDrag();
    }
  }

  function setLastMove(move) {
    lastMove = move;
  }

  function setKingOutcome(nextOutcomeByColor) {
    kingOutcomeByColor = nextOutcomeByColor;
  }

  function setBlindMarkers({ squares = [], visible = false }) {
    blindSquares = new Set(squares);
    showBlindMarkers = visible;
  }

  function onSquareClick(square) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }

    if (!interactionEnabled) {
      return;
    }

    if (selectedSquare) {
      if (square === selectedSquare) {
        clearLegalTargets();
        return;
      }

      if (legalTargets.includes(square)) {
        const from = selectedSquare;
        clearSelection();
        render(position, orientation);
        onHumanMoveAttempt({ from, to: square });
        return;
      }
    }

    const piece = position[square];
    if (!piece || !canSelectSquare(square, piece)) {
      clearLegalTargets();
      return;
    }

    const targets = getLegalTargets(square);
    showLegalTargets(square, targets);
  }

  function render(nextPosition, nextOrientation = orientation) {
    position = nextPosition;
    orientation = nextOrientation;

    container.innerHTML = '';
    const squares = squaresForOrientation(orientation);

    for (const square of squares) {
      const squareShade = squareColor(square);
      const file = square[0];
      const rank = square[1];
      const piece = position[square];

      const squareEl = document.createElement('button');
      squareEl.type = 'button';
      squareEl.className = `square ${squareShade}`;
      squareEl.dataset.square = square;
      squareEl.setAttribute('aria-label', `Square ${square}`);

      squareEl.addEventListener('click', () => onSquareClick(square));

      if (lastMove && (square === lastMove.from || square === lastMove.to)) {
        squareEl.classList.add('last-move');
      }

      if (selectedSquare === square) {
        squareEl.classList.add('selected');
      }

      if (dragState?.hoverSquare === square && legalTargets.includes(square)) {
        squareEl.classList.add('drag-hover');
      }

      if (piece?.type === 'k' && kingOutcomeByColor[piece.color]) {
        squareEl.classList.add(`king-${kingOutcomeByColor[piece.color]}`);
      }

      const coordTextClass = squareShade === 'dark' ? 'light-text' : 'dark-text';
      const leftFile = orientation === 'w' ? 'a' : 'h';
      const bottomRank = orientation === 'w' ? '1' : '8';
      const showRankLabel = file === leftFile;
      const showFileLabel = rank === bottomRank;

      if (showRankLabel) {
        const rankLabel = document.createElement('span');
        rankLabel.className = `coord coord-rank ${coordTextClass}`;
        rankLabel.textContent = rank;
        squareEl.appendChild(rankLabel);
      }

      if (showFileLabel) {
        const fileLabel = document.createElement('span');
        fileLabel.className = `coord coord-file ${coordTextClass}`;
        fileLabel.textContent = file;
        squareEl.appendChild(fileLabel);
      }

      if (legalTargets.includes(square)) {
        const dot = document.createElement('span');
        dot.className = 'legal-dot';
        squareEl.appendChild(dot);
      }

      if (piece) {
        const pieceCode = `${piece.color}${piece.type}`;
        const pieceEl = document.createElement('img');
        pieceEl.className = 'piece';
        pieceEl.src = `${import.meta.env.BASE_URL}assets/chess/${PIECE_IMAGE_BY_CODE[pieceCode]}`;
        pieceEl.alt = `${piece.color === 'w' ? 'white' : 'black'} ${piece.type}`;
        pieceEl.draggable = false;
        pieceEl.addEventListener('dragstart', (event) => event.preventDefault());

        if (dragState?.fromSquare === square) {
          pieceEl.classList.add('piece-dragging-source');
        }

        squareEl.appendChild(pieceEl);

        if (showBlindMarkers && blindSquares.has(square)) {
          const blindMarker = document.createElement('span');
          blindMarker.className = 'blind-marker';

          const blindIcon = document.createElement('img');
          blindIcon.className = 'blind-marker-icon';
          blindIcon.src = `${import.meta.env.BASE_URL}assets/blindfish/blind.png`;
          blindIcon.alt = '';
          blindIcon.setAttribute('aria-hidden', 'true');

          blindMarker.appendChild(blindIcon);
          squareEl.appendChild(blindMarker);
        }
      }

      container.appendChild(squareEl);
    }

    if (dragState) {
      const pieceCode = `${dragState.piece.color}${dragState.piece.type}`;
      const dragPieceEl = document.createElement('img');
      dragPieceEl.className = 'drag-piece-preview';
      dragPieceEl.src = `${import.meta.env.BASE_URL}assets/chess/${PIECE_IMAGE_BY_CODE[pieceCode]}`;
      dragPieceEl.alt = '';
      dragPieceEl.setAttribute('aria-hidden', 'true');
      dragPieceEl.style.left = `${dragState.pointerPosition.localX}px`;
      dragPieceEl.style.top = `${dragState.pointerPosition.localY}px`;
      container.appendChild(dragPieceEl);
    }
  }

  container.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  return {
    render,
    setInteractionEnabled,
    setLastMove,
    setKingOutcome,
    setBlindMarkers,
    setMoveQueryHandlers,
    showLegalTargets,
    clearLegalTargets,
    clearSelection
  };
}
