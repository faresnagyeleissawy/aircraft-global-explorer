// Keyboard state. Arrow keys (with Shift) are all a vehicle needs; W and S
// are extra keys for plane throttle and drone height. Other keys trigger actions.
const KEY_MAP = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ShiftLeft: "boost",
  ShiftRight: "boost",
  Space: "brake",
  KeyW: "throttleUp",
  KeyS: "throttleDown",
};

export function createInput(onAction) {
  const state = {
    up: false,
    down: false,
    left: false,
    right: false,
    boost: false,
    brake: false,
    throttleUp: false,
    throttleDown: false,
  };

  function isTyping(e) {
    const tag = e.target && e.target.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }

  window.addEventListener("keydown", (e) => {
    if (isTyping(e)) return;
    const name = KEY_MAP[e.code];
    if (name) {
      state[name] = true;
      e.preventDefault();
      return;
    }
    if (!e.repeat) onAction(e.code);
  });

  window.addEventListener("keyup", (e) => {
    const name = KEY_MAP[e.code];
    if (name) state[name] = false;
  });

  // Releasing everything on blur stops the player running away when the tab loses focus.
  window.addEventListener("blur", () => {
    for (const key of Object.keys(state)) state[key] = false;
  });

  return state;
}
