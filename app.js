const providerSelect = document.querySelector("#providerSelect");
const providerHint = document.querySelector("#providerHint");
const modelLabel = document.querySelector("#modelLabel");
const tabs = document.querySelectorAll(".context-tab");
const panels = document.querySelectorAll(".panel");
const timeline = document.querySelector("#timeline");
const composer = document.querySelector("#composer");
const prompt = document.querySelector("#prompt");
const runCheck = document.querySelector("#runCheck");
const terminal = document.querySelector("#terminal");
const pageButtons = document.querySelectorAll("[data-page]");
const pages = document.querySelectorAll(".app-page");

providerSelect.addEventListener("change", () => {
  const value = providerSelect.value;
  const model = value.split("·").at(-1).trim();
  modelLabel.textContent = model;
  providerHint.textContent = value.includes("OpenAI")
    ? "Responses API · tools enabled"
    : value.includes("Local")
      ? "Local gateway · terminal only"
      : "Chat Completions · compatible mode";
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    panels.forEach((panel) => panel.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.panel}`).classList.add("active");
  });
});

document.querySelectorAll(".tool-head").forEach((button) => {
  button.addEventListener("click", () => {
    const output = document.querySelector(`#${button.dataset.target}`);
    output.classList.toggle("collapsed");
    button.querySelector("span").textContent = output.classList.contains("collapsed") ? "▸" : "▾";
  });
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = prompt.value.trim();
  if (!text) return;

  const user = document.createElement("article");
  user.className = "bubble user";
  user.innerHTML = `<div class="avatar">你</div><div class="bubble-body"></div>`;
  user.querySelector(".bubble-body").textContent = text;
  timeline.appendChild(user);

  const assistant = document.createElement("article");
  assistant.className = "bubble assistant";
  assistant.innerHTML = `
    <div class="avatar">C</div>
    <div class="bubble-body">
      <p>收到。我会继续在当前 Docker workspace 里处理，并把命令输出和 diff 保持在右侧上下文面板。</p>
    </div>
  `;
  timeline.appendChild(assistant);

  terminal.textContent += `codex task "${text.replaceAll('"', "'")}"\nplanning -> updating patch -> waiting for confirmation\ncoder@runner:/workspace$ `;
  prompt.value = "";
  timeline.scrollTop = timeline.scrollHeight;
  terminal.scrollTop = terminal.scrollHeight;
});

runCheck.addEventListener("click", () => {
  const terminalTab = document.querySelector('[data-panel="terminalPanel"]');
  terminalTab.click();
  terminal.textContent += "pnpm check\napi: typecheck passed\nweb: lint passed\ncoder@runner:/workspace$ ";
  terminal.scrollTop = terminal.scrollHeight;
});

pageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    pageButtons.forEach((item) => item.classList.remove("active"));
    pages.forEach((page) => page.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.page}`).classList.add("active");
  });
});
