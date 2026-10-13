// List of places under a text input. While typing, lookup(text) resolves to
// an array of places ({ name, ... }) to offer; show(places) offers a given
// list, such as the results of a finished search. onPick(place) is called
// with the chosen one. Inside the input, the up and down arrows move through
// the list and Enter picks the highlighted line.

const MIN_LENGTH = 3;
const DELAY = 300; // ms after the last keystroke, to spare the lookup service

export function attachSuggest(input, lookup, onPick) {
  const list = document.createElement("ul");
  list.className = "suggest";
  list.hidden = true;
  document.body.appendChild(list);

  let items = [];
  let active = -1;
  let ticket = 0; // identifies the latest request, so slow answers to old ones are dropped
  let timer = 0;
  let shown = false; // true for a list put up by show(), which stays when the input loses focus

  function close() {
    items = [];
    active = -1;
    shown = false;
    list.hidden = true;
  }

  function cancel() {
    ticket++;
    clearTimeout(timer);
    close();
  }

  function pick(index) {
    const place = items[index];
    cancel();
    input.value = place.name;
    onPick(place);
  }

  function render() {
    list.replaceChildren(
      ...items.map((place, i) => {
        const line = document.createElement("li");
        line.textContent = place.name;
        line.classList.toggle("active", i === active);
        // pointerdown, not click: it comes before the input loses focus, for
        // a finger as well as a mouse.
        line.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          pick(i);
        });
        return line;
      })
    );
    const box = input.getBoundingClientRect();
    list.style.left = box.left + "px";
    list.style.top = box.bottom + 2 + "px";
    list.style.minWidth = box.width + "px";
    list.hidden = items.length === 0;
  }

  input.addEventListener("input", () => {
    const text = input.value.trim();
    const mine = ++ticket;
    clearTimeout(timer);
    if (text.length < MIN_LENGTH) {
      close();
      return;
    }
    timer = setTimeout(async () => {
      let found = [];
      try {
        found = await lookup(text);
      } catch {
        // No suggestions this time; the search itself still works.
      }
      if (mine !== ticket) return;
      items = found;
      active = -1;
      render();
    }, DELAY);
  });

  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length + 1) % (items.length + 1);
      if (active === items.length) active = -1;
      render();
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      close();
    }
  });

  // A list put up by show() outlives the input's focus, so that it can be
  // read and tapped; a press anywhere else puts it away.
  input.addEventListener("blur", () => {
    if (!shown) close();
  });
  document.addEventListener("pointerdown", (e) => {
    if (shown && e.target !== input && !list.contains(e.target)) cancel();
  });

  function show(places) {
    cancel();
    items = places;
    shown = true;
    render();
  }

  return { cancel, show };
}
