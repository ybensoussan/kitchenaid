// Inline edit mode for recipe detail page.
// Depends on: api.js (global), toast() utility defined in recipe.js

const editor = (() => {
  let recipeId = null;
  let isEditMode = false;
  let onIngredientChange = null; // callback to re-render ingredients
  let onStepChange = null;       // callback to re-render steps

  function init(id, opts = {}) {
    recipeId = id;
    onIngredientChange = opts.onIngredientChange || null;
    onStepChange = opts.onStepChange || null;
  }

  // ── Toggle edit mode ──────────────────────────────────────────────────────

  function toggle() {
    isEditMode = !isEditMode;
    document.body.classList.toggle('edit-mode', isEditMode);
    return isEditMode;
  }

  function isActive() { return isEditMode; }

  // ── Inline contenteditable PATCH ─────────────────────────────────────────

  function makeEditable(el, field, transform) {
    el.setAttribute('contenteditable', 'true');
    el.addEventListener('blur', () => {
      let value = el.textContent.trim();
      if (transform) value = transform(value);
      // keepalive ensures the request survives navigation (e.g. clicking "All Recipes"
      // immediately after editing fires blur, but the page unloads before the fetch
      // normally completes — this is why tagless recipes looked stale on the grid).
      fetch(`/api/recipes/${recipeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
        keepalive: true,
      }).then(async res => {
        const json = await res.json();
        if (json.error) showToast('Save failed: ' + json.error, true);
      }).catch(() => {
        // Silently ignore — page may have already navigated away
      });
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      }
    });
  }

  // ── Ingredient modal ──────────────────────────────────────────────────────

  function openIngredientModal(existing, recipeIngredients, onSave) {
    const overlay = document.getElementById('ingredient-modal');
    const form = document.getElementById('ingredient-form');
    form.reset();

    // Populate unit select from shared unit list
    unitList.populateSelect(form.querySelector('[name=unit]'), existing?.unit || '');

    if (existing) {
      form.querySelector('[name=name]').value   = existing.name;
      form.querySelector('[name=amount]').value = existing.amount;
      form.querySelector('[name=notes]').value  = existing.notes;
    }

    overlay.classList.add('open');

    // Wire pantry button
    const pantryBtn = document.getElementById('ingredient-pantry-btn');
    const newPantry = pantryBtn.cloneNode(true);
    pantryBtn.replaceWith(newPantry);
    newPantry.addEventListener('click', async () => {
      const name   = form.querySelector('[name=name]').value.trim();
      if (!name) { showToast('Enter a name first', true); return; }
      const amount = parseFloat(form.querySelector('[name=amount]')?.value) || 0;
      const unit   = form.querySelector('[name=unit]')?.value || '';
      const notes  = form.querySelector('[name=notes]')?.value.trim() || '';
      try {
        await api.createPantryItem({ name, amount, unit, notes });
        showToast(`"${name}" saved to pantry`);
      } catch (e) {
        showToast('Pantry save failed: ' + e.message, true);
      }
    });

    const delBtn = document.getElementById('ingredient-delete-btn');
    if (existing) {
      delBtn.style.display = 'inline-flex';
      const newDel = delBtn.cloneNode(true);
      delBtn.replaceWith(newDel);
      newDel.addEventListener('click', async () => {
        if (await deleteIngredient(existing)) {
          overlay.classList.remove('open');
        }
      });
    } else {
      delBtn.style.display = 'none';
    }

    const saveBtn = document.getElementById('ingredient-save-btn');
    const newSave = saveBtn.cloneNode(true);
    saveBtn.replaceWith(newSave);

    newSave.addEventListener('click', async () => {
      const data = {
        name:      form.querySelector('[name=name]').value.trim(),
        amount:    parseFloat(form.querySelector('[name=amount]').value) || 0,
        unit:      form.querySelector('[name=unit]').value.trim(),
        notes:     form.querySelector('[name=notes]').value.trim(),
        sort_order: existing ? existing.sort_order : (recipeIngredients.length),
      };
      if (!data.name) { showToast('Name is required', true); return; }

      try {
        if (existing) {
          await api.updateIngredient(recipeId, existing.id, data);
        } else {
          await api.addIngredient(recipeId, data);
        }
        overlay.classList.remove('open');
        if (onIngredientChange) onIngredientChange();
      } catch (e) {
        showToast('Save failed: ' + e.message, true);
      }
    });

    overlay.querySelectorAll('.modal-close').forEach(btn => {
      btn.onclick = () => overlay.classList.remove('open');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  }

  async function deleteIngredient(ing) {
    if (!confirm(`Delete "${ing.name}"?`)) return false;
    try {
      await api.deleteIngredient(recipeId, ing.id);
      if (onIngredientChange) onIngredientChange();
      return true;
    } catch (e) {
      showToast('Delete failed: ' + e.message, true);
      return false;
    }
  }

  // ── Step inline editing ───────────────────────────────────────────────────

  function makeStepEditable(stepItem, step, steps, afterSave) {
    const textEl = stepItem.querySelector('.step-text');
    const original = textEl.textContent;

    const textarea = document.createElement('textarea');
    textarea.className = 'step-textarea';
    textarea.value = original;
    textEl.replaceWith(textarea);
    textarea.focus();

    textarea.addEventListener('blur', async () => {
      const newText = textarea.value.trim() || original;
      try {
        await api.updateStep(recipeId, step.id, {
          step_number: step.step_number,
          instruction: newText,
          duration: step.duration,
        });
        if (onStepChange) onStepChange();
      } catch (e) {
        showToast('Save failed: ' + e.message, true);
      }
    });
  }

  async function deleteStep(step, allSteps) {
    if (!confirm(`Delete step ${step.step_number}?`)) return;
    try {
      await api.deleteStep(recipeId, step.id);
      
      // Renumber remaining steps
      const remaining = allSteps.filter(s => s.id !== step.id)
        .sort((a, b) => a.step_number - b.step_number);
      
      for (let i = 0; i < remaining.length; i++) {
        const newNum = i + 1;
        if (remaining[i].step_number !== newNum) {
          await api.updateStep(recipeId, remaining[i].id, {
            step_number: newNum,
            instruction: remaining[i].instruction,
            duration: remaining[i].duration
          });
        }
      }

      if (onStepChange) onStepChange();
    } catch (e) {
      showToast('Delete failed: ' + e.message, true);
    }
  }

  async function addStep(steps) {
    const newNum = steps.length + 1;
    const text = prompt(`Enter step ${newNum} instruction:`);
    if (!text) return;
    try {
      await api.addStep(recipeId, { step_number: newNum, instruction: text, duration: 0 });
      if (onStepChange) onStepChange();
    } catch (e) {
      showToast('Add step failed: ' + e.message, true);
    }
  }

  return {
    init, toggle, isActive,
    makeEditable,
    openIngredientModal, deleteIngredient,
    makeStepEditable, deleteStep, addStep,
  };
})();

// Global toast helper (used by editor and recipe.js)
function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
