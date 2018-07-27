/**
 * @license
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import MDCFoundation from '@material/base/foundation';
import MDCChipSetAdapter from './adapter';
// eslint-disable-next-line no-unused-vars
import {MDCChipFoundation, MDCChipInteractionEventType} from '../chip/foundation';
import {strings, cssClasses} from './constants';

/**
 * @extends {MDCFoundation<!MDCChipSetAdapter>}
 * @final
 */
class MDCChipSetFoundation extends MDCFoundation {
  /** @return enum {string} */
  static get strings() {
    return strings;
  }

  /** @return enum {string} */
  static get cssClasses() {
    return cssClasses;
  }

  /**
   * {@see MDCChipSetAdapter} for typing information on parameters and return
   * types.
   * @return {!MDCChipSetAdapter}
   */
  static get defaultAdapter() {
    return /** @type {!MDCChipSetAdapter} */ ({
      hasClass: () => {},
      removeChip: () => {},
    });
  }

  /**
   * @param {!MDCChipSetAdapter} adapter
   */
  constructor(adapter) {
    super(Object.assign(MDCChipSetFoundation.defaultAdapter, adapter));

    /**
     * The selected chips in the set. Only used for choice chip set or filter chip set.
     * @private {!Array<number>}
     */
    this.selectedChipIds_ = [];
  }

  /**
   * Selects the given chip. Deselects all other chips if the chip set is of the choice variant.
   * @param {!MDCChipFoundation} chipFoundation
   */
  select(chipId) {
    if (this.adapter_.hasClass(cssClasses.CHOICE)) {
      this.deselectAll_();
    }
    this.adapter_.setSelected(chipId, true);
    this.selectedChipIds_.push(chipId);
  }

  /**
   * Deselects the given chip.
   * @param {!MDCChipFoundation} chipFoundation
   */
  deselect(chipId) {
    const index = this.selectedChipIds_.indexOf(chipId);
    if (index >= 0) {
      this.selectedChipIds_.splice(index, 1);
    }
    this.adapter_.setSelected(chipId, false);
  }

  /** Deselects all selected chips. */
  deselectAll_() {
    this.selectedChipIds_.forEach((chipId) => {
      this.adapter_.setSelected(chipId, false);
    });
    this.selectedChipIds_.length = 0;
  }

  /**
   * Handles a chip interaction event
   * @param {!MDCChipInteractionEventType} evt
   * @private
   */
  handleChipInteraction(evt) {
    const {chipId} = evt.detail;
    if (this.adapter_.hasClass(cssClasses.CHOICE) || this.adapter_.hasClass(cssClasses.FILTER)) {
      if (this.selectedChipIds_.includes(chipId)) {
        this.deselect(chipId);
      } else {
        this.select(chipId);
      }
    }
  }

  /**
   * Handles the event when a chip is removed.
   * @param {!MDCChipInteractionEventType} evt
   * @private
   */
  handleChipRemoval(evt) {
    const {chip} = evt.detail;
    this.deselect(chip.foundation);
    this.adapter_.removeChip(chip);
  }
}

export default MDCChipSetFoundation;
