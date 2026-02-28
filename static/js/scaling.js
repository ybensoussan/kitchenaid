// Portion scaling module.

const scaling = (() => {
  let baseServings = 4;
  let desiredServings = 4;

  function getScaleFactor() {
    return baseServings > 0 ? desiredServings / baseServings : 1;
  }

  function getScaledAmount(base) {
    return base * getScaleFactor();
  }

  function setBase(n) {
    baseServings = n || 4;
  }

  function setDesired(n) {
    desiredServings = Math.max(1, n);
    document.dispatchEvent(new CustomEvent('scalingChanged', {
      detail: { desired: desiredServings, factor: getScaleFactor() }
    }));
  }

  function getDesired() { return desiredServings; }
  function getBase()    { return baseServings; }

  // Wire up a servings UI: input + quick buttons
  function wireUI(inputEl, btnEls) {
    inputEl.value = desiredServings;

    inputEl.addEventListener('input', () => {
      const v = parseInt(inputEl.value, 10);
      if (!isNaN(v) && v > 0) setDesired(v);
    });

    btnEls.forEach(btn => {
      btn.addEventListener('click', () => {
        const mult = parseFloat(btn.dataset.mult);
        const newVal = Math.max(1, Math.round(baseServings * mult));
        setDesired(newVal);
        inputEl.value = newVal;
        btnEls.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Keep active state in sync
    document.addEventListener('scalingChanged', () => {
      inputEl.value = desiredServings;
      btnEls.forEach(btn => {
        const expected = Math.round(baseServings * parseFloat(btn.dataset.mult));
        btn.classList.toggle('active', desiredServings === expected);
      });
    });
  }

  return { getScaleFactor, getScaledAmount, setBase, setDesired, getDesired, getBase, wireUI };
})();
