// TODO(acdvorak): Fix bug where Drop Spacer is placed incorrectly:
// 1. Resize window so that 2 columns are visible
// 2. Drag Card #7 _before_ #3, but DON'T LET GO
// 3. Drag #7 _before_ #1

/** @enum {string} */
const DropSide = {
  BEFORE: 'before',
  AFTER: 'after',
};

/** @enum {string} */
const Directionality = {
  LTR: 'ltr',
  RTL: 'rtl',
};

function getDirectionality(element) {
  const ancestor = element.closest('[dir]');
  return (ancestor && ancestor.getAttribute('dir') === Directionality.RTL)
    ? Directionality.RTL
    : Directionality.LTR;
}

function isLTR(element) {
  return getDirectionality(element) === Directionality.LTR;
}

function getClosestDragCollectionElement(element) {
  return element.closest('.mdc-drag-collection');
}

function getOffset(elementRect, parentRect) {
  const offsetRect = {};
  offsetRect.top = offsetRect.y = elementRect.top - parentRect.top;
  offsetRect.left = offsetRect.x = elementRect.left - parentRect.left;
  offsetRect.right = offsetRect.left + elementRect.width;
  offsetRect.bottom = offsetRect.top + elementRect.height;
  offsetRect.width = elementRect.width;
  offsetRect.height = elementRect.height;
  return offsetRect;
}

function getRelativeOffset(el, parent) {
  const elRect = el.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  return getOffset(elRect, parentRect);
}

function getPointerPositionInViewport(e) {
  const originalEvent = e.originalEvent;
  const nativePointerEvent = originalEvent.touches ? originalEvent.touches[0] : originalEvent;
  return {
    x: nativePointerEvent.clientX,
    y: nativePointerEvent.clientY,
  };
}

// From https://developer.mozilla.org/en-US/docs/Web/Events/resize#requestAnimationFrame
const optimizedResize = (function() {
  const callbacks = [];
  let running = false;
  let timer = null;

  // fired on resize event
  function handleResize(e) {
    if (!running) {
      running = true;
      const fps = 2;
      const delayInMs = Math.ceil(1000/fps);
      clearTimeout(timer);
      timer = setTimeout(() => window.requestAnimationFrame(() => runCallbacks(e)), delayInMs);
    }
  }

  // run the actual callbacks
  function runCallbacks(e) {
    callbacks.forEach((callback) => {
      callback(e);
    });
    running = false;
  }

  // adds callback to loop
  function addCallback(callback) {
    if (callback) {
      callbacks.push(callback);
    }
  }

  return {
    // public method to add additional callback
    add: function(callback) {
      if (!callbacks.length) {
        window.addEventListener('resize', handleResize, {
          capture: true,
          passive: true
        });
      }
      addCallback(callback);
    }
  }
}());

class HitTest {
  static isPointAboveRect(point, rect) {
    return point.y < rect.top;
  }
  static isPointBelowRect(point, rect) {
    return point.y > rect.bottom;
  }
  static isPointLeftOfRect(point, rect) {
    return point.x < rect.left;
  }
  static isPointRightOfRect(point, rect) {
    return point.x > rect.right;
  }
  static pointIntersectsRect(point, rect) {
    return !(
      HitTest.isPointAboveRect(point, rect) ||
      HitTest.isPointBelowRect(point, rect) ||
      HitTest.isPointLeftOfRect(point, rect) ||
      HitTest.isPointRightOfRect(point, rect)
    );
  }
}

// NOTE(acdvorak): This code assumes:
// 1. ALL ITEMS ARE THE SAME SIZE
// 2. HORIZONTAL AND VERTICAL ALLEYS BETWEEN ITEMS ARE IDENTICAL
class DragCollection {
  constructor(rootEl) {
    this.rootEl_ = rootEl;
    // TODO(acdvorak): If the container is RTL, make sure the cloned "mirror" element has `dir="rtl"`.
    this.dragManager_ = new Draggable.Draggable(this.rootEl_, {
      draggable: '.mdc-draggable-item',
      delay: 200,
      classes: {
        'container:dragging': 'mdc-drag-collection--dragging',
        'source:dragging': 'mdc-draggable-item--source',
        'mirror': 'mdc-draggable-item--mirror',
      },
    });
    this.dragManager_.on('drag:start', (e) => this.handleDragStart_(e));
    this.dragManager_.on('drag:move', (e) => this.handleDragMove_(e));
    this.dragManager_.on('drag:stop', (e) => this.handleDragStop_(e));

    // TODO(acdvorak): Remove handler in destruct method
    optimizedResize.add((e) => this.handleResize_(e));

    const {dropSpacerEl, dropIndicatorEl} = DragCollection.createDropEls_();
    this.dropSpacerEl_ = dropSpacerEl;
    this.dropIndicatorEl_ = dropIndicatorEl;

    this.resetState_();
  }

  isLTR() {
    return isLTR(this.rootEl_);
  }

  static createDropEls_() {
    const dropZoneElDummyParent = document.createElement('div');
    dropZoneElDummyParent.innerHTML = `
<div class="mdc-drop-spacer"></div>
<div class="mdc-drop-indicator"></div>
  `.trim();
    const dropSpacerEl = dropZoneElDummyParent.children[0];
    const dropIndicatorEl = dropZoneElDummyParent.children[1];
    return {dropSpacerEl, dropIndicatorEl};
  }

  resetState_() {
    this.removeSingleColumnClass_();

    // TODO(acdvorak): Destroy or reuse old objects; optimize performance on low-end devices.
    const {items, rows} = this.getDraggableItems_();

    this.rowAlleyInPx_ = DragCollection.getRowAlleyInPx_(rows);
    this.colAlleyInPx_ = DragCollection.getColAlleyInPx_(rows);
    this.draggableItemList_ = items;
    this.rows_ = rows;
    this.dropZones_ = this.getDropZones_(rows, this.rowAlleyInPx_, this.colAlleyInPx_);
    this.activeDropZone_ = null;
    this.sourceItemEl_ = null;
    this.spacerThicknessInPx_ = DragCollection.getSpacerThicknessInPx_(this.rootEl_, rows);

    this.autoSetSingleColumnClass_();
  }

  removeDraggingStateElements_() {
    this.dropSpacerEl_.remove();
    this.dropIndicatorEl_.remove();
  }

  handleDragStart_(e) {
    this.resetState_();
    this.sourceItemEl_ = e.originalSource;
  }

  autoSetSingleColumnClass_() {
    if (this.isSingleColumnMode()) {
      this.addSingleColumnClass_();
    }
  }

  handleDragMove_(e) {
    e.originalEvent.preventDefault();

    const dropZone = this.activeDropZone_ = DragCollection.getDropZone_(e, this.dropZones_);

    // TODO(acdvorak): Avoid thrashing the DOM, especially on low-end devices.
    this.resetItemOffsets_(this.draggableItemList_);

    if (!dropZone) {
      this.removeDraggingStateElements_();
      return;
    }

    this.insertDropZoneElement_(dropZone);

    if (this.needsSpacer_(dropZone, this.rootEl_)) {
      this.insertDropSpacerElement_(dropZone);
    }

    if (this.isSingleColumnMode()) {
      const curCol = this.rows_.map((row) => row[0]);
      curCol.forEach((curItemInCol, curRowIndex) => {
        this.setItemOffsetY_(curRowIndex, curItemInCol);
      });
    } else {
      const curRow = this.rows_[dropZone.rowIndex];
      curRow.forEach((curItemInRow, curColIndex) => {
        this.setItemOffsetX_(curColIndex, curItemInRow);
      });
    }
  }

  handleDragStop_(e) {
    this.resetItemOffsets_(this.draggableItemList_);
    this.removeDraggingStateElements_();

    if (this.activeDropZone_) {
      this.dropItLikeItsHot_(e);
    }

    if (this.sourceItemEl_.ripple) {
      // TODO(acdvorak): Submit PR to "draggable" repo to pass through originalEvent to drag:stop
      // TODO(acdvorak): Submit PR to "draggable" repo to listen for ESC key
//              this.sourceItemEl_.ripple.deactivate(e.originalEvent);

      // TODO(acdvorak): Submit PR to fix Ripple so that it doesn't require an event object
      this.sourceItemEl_.ripple.deactivate({type: 'pointerup'});
    }

    this.resetState_();
  }

  handleResize_(e) {
    this.resetState_();
  }

  insertDropZoneElement_(dropZone) {
    if (this.isSingleColumnMode()) {
      this.dropIndicatorEl_.style.height = '';
      this.dropIndicatorEl_.style.width = `${dropZone.associatedItem.parentOffsetRect.width}px`;
    } else {
      this.dropIndicatorEl_.style.height = `${dropZone.associatedItem.parentOffsetRect.height}px`;
      this.dropIndicatorEl_.style.width = '';
    }

    this.insertAdjacentElement_(dropZone.associatedItem.rootEl, this.dropIndicatorEl_, dropZone.dropSide);
  }

  insertDropSpacerElement_(dropZone) {
    if (this.isSingleColumnMode()) {
      this.dropSpacerEl_.style.height = '';
      this.dropSpacerEl_.style.width = '';
    } else {
      this.dropSpacerEl_.style.width = `${this.spacerThicknessInPx_}px`;
      this.dropSpacerEl_.style.height = `unset`;
    }

    this.insertAdjacentElement_(this.dropIndicatorEl_, this.dropSpacerEl_, dropZone.dropSide);
  }

  isSingleColumnMode() {
    return !this.isMultiColumnMode();
  }

  isMultiColumnMode() {
    return Boolean(this.rows_) && this.rows_.length > 0 && this.rows_[0].length > 1;
  }

  addSingleColumnClass_() {
    this.rootEl_.classList.add('mdc-drag-collection--single-column');
  }

  removeSingleColumnClass_() {
    this.rootEl_.classList.remove('mdc-drag-collection--single-column');
  }

  needsSpacer_(dropZone) {
    if (!this.isMultiColumnMode()) {
      return false;
    }

    // TODO(acdvorak): Create a method for this in DropZone class
    const isFirstRow = dropZone.rowIndex === 0;
    // TODO(acdvorak): Create a method for this in DropZone class
    const isFirstItemInRow = this.isLTR()
        ? dropZone.isBeforeItem() && dropZone.colIndex === 0
        : dropZone.isAfterItem() && dropZone.colIndex === dropZone.lastIndexInCurRow();
    return !isFirstRow && isFirstItemInRow;
  }

  setItemOffsetY_(itemRowIndex, item) {
    const dzIsAfterItem = this.activeDropZone_.isAfterItem();
    const multiplier = (dzIsAfterItem || (itemRowIndex < this.activeDropZone_.rowIndex)) ? -1 : +1;
    item.offsetX = 0;
    item.offsetY = multiplier * (this.activeDropZone_.rowAlleyInPx_ / 2);
  }

  setItemOffsetX_(itemColIndex, item) {
    const dzIsAfterItem = this.activeDropZone_.isAfterItem();
    const multiplier = (dzIsAfterItem || (itemColIndex < this.activeDropZone_.colIndex)) ? -1 : +1;
    item.offsetY = 0;
    item.offsetX = multiplier * (this.colAlleyInPx_ / 2);
  }

  resetItemOffsets_(items) {
    items.forEach((item) => {
      item.clearOffsets();
    });
  }

  dropItLikeItsHot_(e) {
    const associatedItemEl = this.activeDropZone_.associatedItem.rootEl;
    const dragSourceEl = e.originalSource;
    const dropSide = this.activeDropZone_.dropSide;
    setTimeout(() => {
      this.insertAdjacentElement_(associatedItemEl, dragSourceEl, dropSide);
    });
  }

  /**
   * @param {!HTMLElement} refEl
   * @param {!HTMLElement} newEl
   * @param {!DropSide} dropSide
   * @private
   */
  insertAdjacentElement_(refEl, newEl, dropSide) {
    const beforeItem = dropSide === DropSide.BEFORE;

    let relPos;
    if (this.isSingleColumnMode() || isLTR(refEl.parentNode)) {
      relPos = beforeItem ? 'beforebegin' : 'afterend';
    } else {
      relPos = beforeItem ? 'afterend' : 'beforebegin';
    }

    // Avoid needless DOM thrashing from reinserting an element in the exact same position it already is.
    if ((relPos === 'beforebegin' && refEl.previousElementSibling !== newEl) ||
        (relPos === 'afterend' && refEl.nextElementSibling !== newEl)) {
      refEl.insertAdjacentElement(relPos, newEl);
    }
  }

  getDraggableItems_() {
    const itemEls = [].slice.call(this.rootEl_.querySelectorAll('.mdc-draggable-item'));
    const items = itemEls
        .map((itemEl) => new DraggableItem(itemEl, this))
        .filter(DraggableItem.isVisible)
        .sort(DraggableItem.orderByCoordinate);

    const rowBuckets = new Map();
    items.forEach((item) => {
      const top = item.parentOffsetRect.top;
      if (!rowBuckets.has(top)) {
        rowBuckets.set(top, []);
      }
      rowBuckets.get(top).push(item);
    });

    const rows = [];
    rowBuckets.forEach((row) => {
      rows.push(row);
    });

    return {items, rows};
  }

  getDropZones_(rows, rowAlleyInPx, colAlleyInPx) {
    const dropZones = [];
    rows.forEach((curRow, rowIndex) => {
      curRow.forEach((curItemInRow, colIndex) => {
        function createDropZone(dropSide) {
          return new DropZone({
            associatedItem: curItemInRow,
            dropSide,
            rowAlleyInPx,
            colAlleyInPx,
            rows,
            rowIndex,
            colIndex,
          });
        }
        dropZones.push(createDropZone(DropSide.BEFORE));
        const addAfterRow = this.isMultiColumnMode() && colIndex === curRow.length - 1;
        const addAfterCol = this.isSingleColumnMode() && rowIndex === rows.length - 1;
        if (addAfterRow || addAfterCol) {
          dropZones.push(createDropZone(DropSide.AFTER));
        }
      });
    });

    return dropZones;
  }

  static getDropZone_(e, dropZones) {
    const pointerPositionInViewport = getPointerPositionInViewport(e);
    for (let curDropZone of dropZones) {
      if (curDropZone.intersectsViewportPoint(pointerPositionInViewport)) {
        if (curDropZone.isAdjacentToDragSource()) {
          return null;
        }
        return curDropZone;
      }
    }
    return null;
  }

  /**
   * @param {!Array<!DraggableItem>} rows
   * @returns {number}
   * @private
   */
  static getColAlleyInPx_(rows) {
    if (rows.length < 1 || rows[0].length < 2) {
      return 0;
    }
    const firstRow = rows[0];
    return firstRow[1].parentOffsetRect.left - firstRow[0].parentOffsetRect.right;
  }

  /**
   * @param {!Array<!DraggableItem>} rows
   * @returns {number}
   * @private
   */
  static getRowAlleyInPx_(rows) {
    if (rows.length < 2) {
      return 0;
    }
    const firstRow = rows[0];
    const secondRow = rows[1];
    return secondRow[0].parentOffsetRect.top - firstRow[0].parentOffsetRect.bottom;
  }

  /**
   * @param {!HTMLElement} dragCollectionEl
   * @param {!Array<!DraggableItem>} rows
   * @returns {number}
   * @private
   */
  static getSpacerThicknessInPx_(dragCollectionEl, rows) {
    if (rows.length === 0 || rows[0].length === 0) {
      return 0;
    }

    const firstRow = rows[0];

    if (isLTR(dragCollectionEl)) {
      const lastItem = firstRow[firstRow.length - 1];
      // TODO(acdvorak): Don't assume px units
      const lastItemMarginRight = parseInt(getComputedStyle(lastItem.rootEl).marginRight, 10);
      const lastItemOffsetRight = lastItem.parentOffsetRect.right + lastItemMarginRight;
      const offsetParentWidth = lastItem.parentDragCollection.getBoundingClientRect().width;
      return offsetParentWidth - lastItemOffsetRight;
    } else {
      const lastItem = firstRow[0];
      // TODO(acdvorak): Don't assume px units
      const lastItemMarginLeft = parseInt(getComputedStyle(lastItem.rootEl).marginLeft, 10);
      return lastItem.parentOffsetRect.left - lastItemMarginLeft;
    }
  }
}

class DraggableItem {
  constructor(rootElement, dragCollection) {
    this.rootEl = rootElement;
    this.dragCollection = dragCollection;
    this.parentDragCollection = getClosestDragCollectionElement(this.rootEl);
    this.parentOffsetRect = getRelativeOffset(this.rootEl, this.parentDragCollection);
    this.offsetX_ = 0;
    this.offsetY_ = 0;
  }

  clearOffsets() {
    this.offsetX_ = 0;
    this.offsetY_ = 0;
    this.rootEl.style.transform = '';
  }

  get offsetX() {
    return this.offsetX_;
  }

  set offsetX(offsetX) {
    this.offsetX_ = offsetX;
    // TODO(acdvorak): Find a way to do this that won't prevent clients from being able to use `transform`.
    this.rootEl.style.transform = this.offsetX_ ? `translateX(${this.offsetX_}px)` : '';
  }

  get offsetY() {
    return this.offsetY_;
  }

  set offsetY(offsetY) {
    this.offsetY_ = offsetY;
    // TODO(acdvorak): Find a way to do this that won't prevent clients from being able to use `transform`.
    this.rootEl.style.transform = this.offsetY_ ? `translateY(${this.offsetY_}px)` : '';
  }

  isDragSource() {
    return this.rootEl.hasAttribute('aria-grabbed');
  }

  static isVisible(item) {
    return item.parentOffsetRect.width > 0 && item.parentOffsetRect.height > 0;
  }

  static orderByCoordinate(firstItem, secondItem) {
    const topDelta = firstItem.parentOffsetRect.top - secondItem.parentOffsetRect.top;
    const leftDelta = firstItem.parentOffsetRect.left - secondItem.parentOffsetRect.left;
    return topDelta || leftDelta;
  }
}

/** Represents an area of the screen where a draggable item can be dropped. */
class DropZone {
  constructor({associatedItem, dropSide, rows, rowIndex, colIndex, rowAlleyInPx, colAlleyInPx} = {}) {
    this.associatedItem = associatedItem;
    this.dropSide = dropSide;
    this.rows_ = rows;
    this.rowIndex = rowIndex;
    this.colIndex = colIndex;
    this.colAlleyInPx_ = colAlleyInPx;
    this.rowAlleyInPx_ = rowAlleyInPx;
    if (this.isSingleColumnMode()) {
      this.horizontalToleranceInPx_ = this.colAlleyInPx_ / 2;
      this.verticalToleranceInPx_ = this.associatedItem.parentOffsetRect.height / 2;
    } else {
      this.horizontalToleranceInPx_ = this.associatedItem.parentOffsetRect.width / 2;
      this.verticalToleranceInPx_ = this.rowAlleyInPx_ / 2;
    }
    this.parentOffsetRect = this.calculateParentOffsetRect_();
  }

  isSingleColumnMode() {
    return this.associatedItem.dragCollection.isSingleColumnMode();
  }

  calculateParentOffsetRect_() {
    const associatedItemParentOffsetRect = this.associatedItem.parentOffsetRect;
    const parentOffsetRect = {};

    if (this.isSingleColumnMode()) {
      parentOffsetRect.left = parentOffsetRect.x = associatedItemParentOffsetRect.left;
      parentOffsetRect.top = parentOffsetRect.y =
        (this.isBeforeItem()
          ? associatedItemParentOffsetRect.top - this.rowAlleyInPx_
          : associatedItemParentOffsetRect.bottom);
      parentOffsetRect.bottom = parentOffsetRect.top + this.rowAlleyInPx_;
      parentOffsetRect.right = associatedItemParentOffsetRect.right;
    } else {
      parentOffsetRect.top = parentOffsetRect.y = associatedItemParentOffsetRect.top;
      parentOffsetRect.left = parentOffsetRect.x =
        (this.isBeforeItem()
          ? associatedItemParentOffsetRect.left - this.colAlleyInPx_
          : associatedItemParentOffsetRect.right);
      parentOffsetRect.right = parentOffsetRect.left + this.colAlleyInPx_;
      parentOffsetRect.bottom = associatedItemParentOffsetRect.bottom;
    }

    // Include tolerances
    parentOffsetRect.top -= this.verticalToleranceInPx_;
    parentOffsetRect.bottom += this.verticalToleranceInPx_;
    parentOffsetRect.left -= this.horizontalToleranceInPx_;
    parentOffsetRect.right += this.horizontalToleranceInPx_;

    parentOffsetRect.width = parentOffsetRect.right - parentOffsetRect.left;
    parentOffsetRect.height = parentOffsetRect.bottom - parentOffsetRect.top;

    return parentOffsetRect;
  }

  intersectsViewportPoint(viewportPoint) {
    // The properties below need to be recalculated every time the pointer moves to ensure that scrolling while
    // dragging works and uses the correct coordinates.
    const collectionViewportRect = this.associatedItem.parentDragCollection.getBoundingClientRect();
    const parentOffsetPoint = {
      x: viewportPoint.x - collectionViewportRect.left,
      y: viewportPoint.y - collectionViewportRect.top,
    };
    return HitTest.pointIntersectsRect(parentOffsetPoint, this.parentOffsetRect);
  }

  // TODO(acdvorak): Abstract away LTR logic?
  isAdjacentToDragSource() {
    if (this.isSingleColumnMode()) {
      return this.associatedItem.isDragSource() || this.prevItemInPrevRowIsDragSource_();
    }
    return this.userDraggedAssociatedItemInCurRow_() ||
           this.userDraggedFirstItemInCurRowToAfterLastItemInPrevRow_() ||
           this.userDraggedLastItemInCurRowToBeforeFirstItemInNextRow_();
  }

  userDraggedAssociatedItemInCurRow_() {
    // prevent drag to adjacent left || prevent drag to adjacent right
    return this.associatedItem.isDragSource() || this.prevAssociatedItemInSameRowIsDragSource_();
  }

  // LTR: User dragged first item in row (N) to after last item in row (N - 1).
  // TODO(acdvorak): It feels like this function (and everything it calls) should belong to a different class.
  userDraggedFirstItemInCurRowToAfterLastItemInPrevRow_() {
    return this.isAdjacentToLastItemInCurRow_() && this.nextItemInNextRowIsDragSource_();
  }

  // LTR: User dragged last item in row (N) to before first item in row (N + 1).
  // TODO(acdvorak): It feels like this function (and everything it calls) should belong to a different class.
  userDraggedLastItemInCurRowToBeforeFirstItemInNextRow_() {
    return this.isAdjacentToFirstItemInNextRow_() && this.prevItemInPrevRowIsDragSource_();
  }

  prevAssociatedItemInSameRowIsDragSource_() {
    // A drop zone attached to the *right* side of a item will always have the same associatedItem value as its
    // sister drop zone on the *left* side of the same item. As a result, if the user drags the second-to-last
    // item to after the last item in a row, omitting this check would lead to the drag being blocked, which is
    // incorrect behavior.
    if (this.isAfterItem()) {
      return false;
    }

    const prevItemInSameRow = this.prevItemInSameRow_();
    return Boolean(prevItemInSameRow) && prevItemInSameRow.isDragSource();
  }

  isAdjacentToLastItemInCurRow_() {
    return this.colIndex === (this.isLTR() ? this.lastIndexInCurRow() : 0);
  }

  isAdjacentToFirstItemInNextRow_() {
    return this.colIndex === (this.isLTR() ? 0 : this.lastIndexInCurRow());
  }

  nextItemInNextRowIsDragSource_() {
    const nextItemInNextRow = this.nextItemInNextRow_();
    const nextItemIsDragSource = Boolean(nextItemInNextRow) && nextItemInNextRow.isDragSource();
    const isLTRish = this.isSingleColumnMode() || this.isLTR();
    return nextItemIsDragSource && (isLTRish ? this.isAfterItem() : this.isBeforeItem());
  }

  prevItemInPrevRowIsDragSource_() {
    const prevItemInPrevRow = this.prevItemInPrevRow_();
    const prevItemIsDragSource = Boolean(prevItemInPrevRow) && prevItemInPrevRow.isDragSource();
    const isLTRish = this.isSingleColumnMode() || this.isLTR();
    return prevItemIsDragSource && (isLTRish ? this.isBeforeItem() : this.isAfterItem());
  }

  nextItemInNextRow_() {
    const nextRow = this.nextRow_();
    return nextRow ? nextRow[this.isLTR() ? 0 : nextRow.length - 1] : null;
  }

  prevItemInPrevRow_() {
    const prevRow = this.prevRow_();
    return prevRow ? prevRow[this.isLTR() ? prevRow.length - 1 : 0] : null;
  }

  prevItemInSameRow_() {
    return this.curRow_()[this.colIndex - 1];
  }

  isBeforeItem() {
    // In multi-column mode LTR, 'before' means 'to the left of'.
    // In multi-column mode RTL, 'before' means 'to the right of'.
    // In single-column mode, 'before' means 'above'.
    return this.dropSide === DropSide.BEFORE;
  }

  isAfterItem() {
    // In multi-column mode LTR, 'after' means 'to the right of'.
    // In multi-column mode RTL, 'after' means 'to the left of'.
    // In single-column mode, 'after' means 'below'.
    return this.dropSide === DropSide.AFTER;
  }

  lastIndexInCurRow() {
    return this.curRow_().length - 1;
  }

  curRow_() {
    return this.rows_[this.rowIndex];
  }

  nextRow_() {
    return this.rows_[this.rowIndex + 1];
  }

  prevRow_() {
    return this.rows_[this.rowIndex - 1];
  }

  isLTR() {
    return isLTR(this.associatedItem.rootEl.parentNode);
  }
}

export {DragCollection};