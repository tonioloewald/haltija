(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __moduleCache = /* @__PURE__ */ new WeakMap;
  var __toCommonJS = (from) => {
    var entry = __moduleCache.get(from), desc;
    if (entry)
      return entry;
    entry = __defProp({}, "__esModule", { value: true });
    if (from && typeof from === "object" || typeof from === "function")
      __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp(entry, key, {
        get: () => from[key],
        enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
      }));
    __moduleCache.set(from, entry);
    return entry;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: (newValue) => all[name] = () => newValue
      });
  };

  // src/component.ts
  var exports_component = {};
  __export(exports_component, {
    inject: () => inject,
    VERSION: () => VERSION2,
    DevChannel: () => DevChannel
  });

  // src/version.ts
  var VERSION = "0.1.7";

  // src/component.ts
  var VERSION2 = VERSION;
  var PRODUCT_NAME = "Haltija";
  var TAG_NAME = "haltija-dev";
  var LOG_PREFIX = "[haltija]";
  var SERVER_SESSION_ID = "";
  var uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  function getSelector(el) {
    const shadowPrefix = [];
    let rootNode = el.getRootNode();
    let hostEl = null;
    while (rootNode instanceof ShadowRoot) {
      shadowPrefix.unshift("::shadow");
      hostEl = rootNode.host;
      const hostParts = [];
      let current2 = hostEl;
      while (current2) {
        let selector = current2.tagName.toLowerCase();
        if (current2.id) {
          selector = `#${current2.id}`;
          hostParts.unshift(selector);
          break;
        }
        if (current2.className && typeof current2.className === "string") {
          const classes = current2.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (classes)
            selector += `.${classes}`;
        }
        hostParts.unshift(selector);
        const nextRoot = current2.getRootNode();
        if (nextRoot instanceof ShadowRoot) {
          break;
        }
        current2 = current2.parentElement;
      }
      shadowPrefix.unshift(...hostParts);
      rootNode = hostEl.getRootNode();
    }
    if (el.id) {
      if (shadowPrefix.length > 0) {
        return `${shadowPrefix.join(" > ")} > #${el.id}`;
      }
      return `#${el.id}`;
    }
    const parts = [];
    let current = el;
    while (current && current !== document.documentElement) {
      const currentRoot = current.getRootNode();
      if (currentRoot instanceof ShadowRoot) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector = `#${current.id}`;
          parts.unshift(selector);
          break;
        }
        if (current.className && typeof current.className === "string") {
          const classes = current.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (classes)
            selector += `.${classes}`;
        }
        const parent = current.parentElement || currentRoot;
        if (parent) {
          const children = parent instanceof ShadowRoot ? Array.from(parent.children) : Array.from(parent.children);
          const siblings = children.filter((c) => c.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-child(${index})`;
          }
        }
        parts.unshift(selector);
        current = current.parentElement;
        if (!current)
          break;
      } else {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector = `#${current.id}`;
          parts.unshift(selector);
          break;
        }
        if (current.className && typeof current.className === "string") {
          const classes = current.className.trim().split(/\s+/).slice(0, 2).join(".");
          if (classes)
            selector += `.${classes}`;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-child(${index})`;
          }
        }
        parts.unshift(selector);
        current = current.parentElement;
      }
    }
    if (shadowPrefix.length > 0) {
      return `${shadowPrefix.join(" > ")} > ${parts.join(" > ")}`;
    }
    return parts.join(" > ");
  }
  function extractElement(el) {
    const rect = el.getBoundingClientRect();
    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id,
      className: el.className?.toString() || "",
      textContent: el.textContent?.slice(0, 1000) || "",
      innerText: el.innerText?.slice(0, 1000) || "",
      outerHTML: el.outerHTML.slice(0, 5000),
      attributes: attrs,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        toJSON: () => rect
      }
    };
  }
  function inspectElement(el) {
    const htmlEl = el;
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    const inViewport = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
    let depth = 0;
    let parent = el.parentElement;
    while (parent) {
      depth++;
      parent = parent.parentElement;
    }
    const attrs = {};
    for (const attr of el.attributes) {
      attrs[attr.name] = attr.value;
    }
    const dataset = {};
    if (htmlEl.dataset) {
      for (const key of Object.keys(htmlEl.dataset)) {
        dataset[key] = htmlEl.dataset[key] || "";
      }
    }
    const childTags = [...new Set(Array.from(el.children).map((c) => c.tagName.toLowerCase()))];
    return {
      selector: getSelector(el),
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classList: Array.from(el.classList),
      box: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: inViewport && computed.display !== "none" && computed.visibility !== "hidden",
        display: computed.display,
        visibility: computed.visibility,
        opacity: parseFloat(computed.opacity)
      },
      offsets: {
        offsetTop: htmlEl.offsetTop,
        offsetLeft: htmlEl.offsetLeft,
        offsetWidth: htmlEl.offsetWidth,
        offsetHeight: htmlEl.offsetHeight,
        offsetParent: htmlEl.offsetParent ? getSelector(htmlEl.offsetParent) : null,
        scrollTop: htmlEl.scrollTop,
        scrollLeft: htmlEl.scrollLeft,
        scrollWidth: htmlEl.scrollWidth,
        scrollHeight: htmlEl.scrollHeight
      },
      text: {
        innerText: htmlEl.innerText?.slice(0, 500) || "",
        textContent: el.textContent?.slice(0, 500) || "",
        value: htmlEl.value || undefined,
        placeholder: htmlEl.placeholder || undefined,
        innerHTML: el.innerHTML.slice(0, 1000)
      },
      attributes: attrs,
      dataset,
      properties: {
        hidden: htmlEl.hidden,
        disabled: htmlEl.disabled,
        checked: htmlEl.checked,
        selected: htmlEl.selected,
        open: htmlEl.open,
        type: htmlEl.type || undefined,
        name: htmlEl.name || undefined,
        required: htmlEl.required,
        readOnly: htmlEl.readOnly,
        href: htmlEl.href || undefined,
        target: htmlEl.target || undefined,
        src: htmlEl.src || undefined,
        alt: htmlEl.alt || undefined,
        role: el.getAttribute("role") || undefined,
        ariaLabel: el.getAttribute("aria-label") || undefined,
        ariaExpanded: el.getAttribute("aria-expanded") === "true",
        ariaHidden: el.getAttribute("aria-hidden") === "true",
        ariaDisabled: el.getAttribute("aria-disabled") === "true",
        ariaSelected: el.getAttribute("aria-selected") === "true",
        ariaCurrent: el.getAttribute("aria-current") || undefined,
        isCustomElement: el.tagName.includes("-"),
        shadowRoot: !!el.shadowRoot
      },
      hierarchy: {
        parent: el.parentElement ? getSelector(el.parentElement) : null,
        children: el.children.length,
        childTags,
        previousSibling: el.previousElementSibling?.tagName.toLowerCase(),
        nextSibling: el.nextElementSibling?.tagName.toLowerCase(),
        depth
      },
      styles: {
        display: computed.display,
        position: computed.position,
        visibility: computed.visibility,
        opacity: computed.opacity,
        overflow: computed.overflow,
        zIndex: computed.zIndex,
        pointerEvents: computed.pointerEvents,
        cursor: computed.cursor,
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight
      }
    };
  }
  var FILTER_PRESETS = {
    none: {},
    xinjs: {
      interestingClasses: ["-xin-event", "-xin-data", "-xin-"],
      interestingAttributes: ["aria-", "role", "title", "data-"],
      ignoreClasses: [
        "^animate-",
        "^transition-",
        "^fade-"
      ]
    },
    b8rjs: {
      interestingAttributes: ["data-event", "data-bind", "data-list", "data-component", "aria-", "role", "title"],
      ignoreClasses: ["^animate-", "^transition-"]
    },
    tailwind: {
      ignoreClasses: [
        "^flex",
        "^grid",
        "^block",
        "^inline",
        "^hidden",
        "^p-",
        "^m-",
        "^px-",
        "^py-",
        "^mx-",
        "^my-",
        "^pt-",
        "^pb-",
        "^pl-",
        "^pr-",
        "^mt-",
        "^mb-",
        "^ml-",
        "^mr-",
        "^gap-",
        "^space-",
        "^w-",
        "^h-",
        "^min-",
        "^max-",
        "^bg-",
        "^text-",
        "^border-",
        "^ring-",
        "^shadow-",
        "^font-",
        "^text-",
        "^leading-",
        "^tracking-",
        "^rounded",
        "^border",
        "^opacity-",
        "^blur-",
        "^brightness-",
        "^transition",
        "^duration-",
        "^ease-",
        "^delay-",
        "^scale-",
        "^rotate-",
        "^translate-",
        "^skew-",
        "^cursor-",
        "^select-",
        "^pointer-",
        "^absolute",
        "^relative",
        "^fixed",
        "^sticky",
        "^static",
        "^top-",
        "^right-",
        "^bottom-",
        "^left-",
        "^inset-",
        "^z-",
        "^overflow-",
        "^truncate",
        "^justify-",
        "^items-",
        "^content-",
        "^self-",
        "^place-",
        "^col-",
        "^row-",
        "^order-",
        "^sm:",
        "^md:",
        "^lg:",
        "^xl:",
        "^2xl:",
        "^hover:",
        "^focus:",
        "^active:",
        "^disabled:",
        "^group-",
        "^dark:"
      ],
      interestingAttributes: ["aria-", "role", "title", "data-"]
    },
    react: {
      ignoreAttributes: [
        "__reactFiber",
        "__reactProps",
        "__reactEvents",
        "data-reactroot",
        "data-reactid"
      ],
      ignoreClasses: ["^css-"],
      interestingAttributes: ["aria-", "role", "title", "data-testid", "data-cy"]
    },
    minimal: {
      ignoreAttributes: ["style", "class"],
      ignoreClasses: [".*"]
    },
    smart: {
      interestingClasses: ["-xin-event", "-xin-data"],
      interestingAttributes: [
        "aria-",
        "role",
        "title",
        "data-event",
        "data-bind",
        "data-list",
        "data-component",
        "data-testid",
        "disabled",
        "hidden",
        "open",
        "checked",
        "selected"
      ],
      ignoreElements: [
        "script",
        "style",
        "link",
        "meta",
        "noscript",
        '[id^="__"]'
      ],
      ignoreClasses: [
        "^animate-",
        "^transition-",
        "^fade-",
        "^slide-",
        "^is-",
        "^has-",
        "^was-"
      ],
      ignoreAttributes: ["style"]
    }
  };
  function detectFramework() {
    const detected = [];
    try {
      if (document.querySelector('[class*="-xin-"]') || typeof window.xin !== "undefined") {
        detected.push("xinjs");
      }
      if (document.querySelector("[data-event]") || document.querySelector("[data-bind]") || typeof window.b8r !== "undefined") {
        detected.push("b8rjs");
      }
      const hasReactRoot = document.querySelector("[data-reactroot]") !== null;
      const hasReactGlobal = typeof window.React !== "undefined";
      const hasReactFiber = Array.from(document.body?.children || []).some((el) => Object.keys(el).some((key) => key.startsWith("__reactFiber") || key.startsWith("__reactProps")));
      if (hasReactRoot || hasReactGlobal || hasReactFiber) {
        detected.push("react");
      }
      const hasTailwind = document.querySelector('[class*="flex"]') && document.querySelector('[class*="p-"]') && document.querySelector('[class*="text-"]');
      if (hasTailwind) {
        detected.push("tailwind");
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Framework detection failed:`, err);
    }
    return detected;
  }
  function mergeFilterRules(...rules) {
    const merged = {
      ignoreClasses: [],
      ignoreAttributes: [],
      ignoreElements: [],
      interestingClasses: [],
      interestingAttributes: [],
      onlySelectors: []
    };
    for (const rule of rules) {
      if (!rule)
        continue;
      if (rule.ignoreClasses)
        merged.ignoreClasses.push(...rule.ignoreClasses);
      if (rule.ignoreAttributes)
        merged.ignoreAttributes.push(...rule.ignoreAttributes);
      if (rule.ignoreElements)
        merged.ignoreElements.push(...rule.ignoreElements);
      if (rule.interestingClasses)
        merged.interestingClasses.push(...rule.interestingClasses);
      if (rule.interestingAttributes)
        merged.interestingAttributes.push(...rule.interestingAttributes);
      if (rule.onlySelectors)
        merged.onlySelectors.push(...rule.onlySelectors);
    }
    return merged;
  }
  function matchesPatterns(value, patterns) {
    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern).test(value))
          return true;
      } catch {
        if (value === pattern || value.includes(pattern))
          return true;
      }
    }
    return false;
  }
  function filterClasses(classes, rules) {
    const ignored = [];
    const interesting = [];
    const other = [];
    for (const cls of classes) {
      if (rules.ignoreClasses?.length && matchesPatterns(cls, rules.ignoreClasses)) {
        ignored.push(cls);
      } else if (rules.interestingClasses?.length && matchesPatterns(cls, rules.interestingClasses)) {
        interesting.push(cls);
      } else {
        other.push(cls);
      }
    }
    return { ignored, interesting, other };
  }
  function isInterestingAttribute(name, rules) {
    if (rules.ignoreAttributes?.some((pattern) => name.startsWith(pattern) || name === pattern)) {
      return false;
    }
    if (rules.interestingAttributes?.some((pattern) => name.startsWith(pattern) || name === pattern)) {
      return true;
    }
    return false;
  }
  function shouldIgnoreElement(el, rules) {
    if (!rules.ignoreElements?.length)
      return false;
    for (const selector of rules.ignoreElements) {
      try {
        if (el.matches(selector))
          return true;
      } catch {
        if (el.tagName.toLowerCase() === selector.toLowerCase())
          return true;
      }
    }
    return false;
  }
  function matchesOnlyFilter(el, rules) {
    if (!rules.onlySelectors?.length)
      return true;
    for (const selector of rules.onlySelectors) {
      try {
        if (el.matches(selector))
          return true;
      } catch {
        continue;
      }
    }
    return false;
  }
  var INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "DETAILS", "SUMMARY"]);
  var DEFAULT_INTERESTING_CLASSES = ["-xin-event", "-xin-data", "-xin-"];
  var DEFAULT_INTERESTING_ATTRS = [
    "aria-",
    "role",
    "title",
    "href",
    "src",
    "alt",
    "data-event",
    "data-bind",
    "data-list",
    "data-component",
    "data-testid",
    "disabled",
    "hidden",
    "open",
    "checked",
    "selected",
    "required",
    "readonly",
    "type",
    "name",
    "value",
    "placeholder"
  ];
  var DEFAULT_IGNORE_SELECTORS = [
    "script",
    "style",
    "link",
    "meta",
    "noscript",
    "svg",
    "path",
    "[data-reactroot-hidden]",
    "#__react-devtools-global-hook__",
    '[class*="__reactdevtools"]',
    "#__vconsole",
    '[id^="__"]'
  ];
  function buildDomTree(el, options, currentDepth = 0) {
    const {
      depth = 3,
      includeText = true,
      allAttributes = false,
      includeStyles = false,
      includeBox = false,
      interestingClasses = DEFAULT_INTERESTING_CLASSES,
      interestingAttributes = DEFAULT_INTERESTING_ATTRS,
      ignoreSelectors = DEFAULT_IGNORE_SELECTORS,
      compact = false,
      pierceShadow = false
    } = options;
    for (const selector of ignoreSelectors) {
      try {
        if (el.matches(selector))
          return null;
      } catch {
        if (el.tagName.toLowerCase() === selector.toLowerCase())
          return null;
      }
    }
    const tagName = el.tagName.toLowerCase();
    const htmlEl = el;
    const node = {
      tag: tagName
    };
    if (el.id) {
      node.id = el.id;
    }
    const allClasses = el.className?.toString().split(/\s+/).filter(Boolean) || [];
    if (allClasses.length > 0) {
      if (allAttributes) {
        node.classes = allClasses;
      } else {
        const interesting = allClasses.filter((cls) => interestingClasses.some((pattern) => {
          try {
            return new RegExp(pattern).test(cls);
          } catch {
            return cls.includes(pattern);
          }
        }));
        if (interesting.length > 0) {
          node.classes = interesting;
        } else if (!compact && allClasses.length <= 3) {
          node.classes = allClasses.slice(0, 3);
        }
      }
    }
    const attrs = {};
    for (const attr of el.attributes) {
      if (attr.name === "id" || attr.name === "class")
        continue;
      if (allAttributes) {
        attrs[attr.name] = attr.value;
      } else {
        const isInteresting = interestingAttributes.some((pattern) => attr.name.startsWith(pattern) || attr.name === pattern);
        if (isInteresting) {
          attrs[attr.name] = attr.value;
        }
      }
    }
    if (Object.keys(attrs).length > 0) {
      node.attrs = attrs;
    }
    const flags = {};
    if (allClasses.some((c) => c.includes("-xin-event")) || el.hasAttribute("data-event")) {
      flags.hasEvents = true;
    }
    if (allClasses.some((c) => c.includes("-xin-data")) || el.hasAttribute("data-bind") || el.hasAttribute("data-list")) {
      flags.hasData = true;
    }
    if (INTERACTIVE_TAGS.has(el.tagName)) {
      flags.interactive = true;
    }
    if (tagName.includes("-")) {
      flags.customElement = true;
    }
    if (el.shadowRoot) {
      flags.shadowRoot = true;
    }
    if (htmlEl.hidden || el.getAttribute("aria-hidden") === "true") {
      flags.hidden = true;
    }
    if (Array.from(el.attributes).some((a) => a.name.startsWith("aria-") || a.name === "role")) {
      flags.hasAria = true;
    }
    if (Object.keys(flags).length > 0) {
      node.flags = flags;
    }
    if (includeBox) {
      const rect = el.getBoundingClientRect();
      const computed = getComputedStyle(el);
      const inViewport = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
      node.box = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        visible: inViewport && computed.display !== "none" && computed.visibility !== "hidden"
      };
    }
    if (includeText) {
      const childElements = el.children.length;
      const directText = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent?.trim()).filter(Boolean).join(" ");
      if (childElements === 0 && directText) {
        node.text = directText.slice(0, 200);
      } else if (directText && directText.length <= 50) {
        node.text = directText;
      }
    }
    const maxDepth = depth < 0 ? Infinity : depth;
    if (pierceShadow && el.shadowRoot && currentDepth < maxDepth) {
      const shadowChildren = [];
      for (const child of el.shadowRoot.children) {
        if (child.tagName === "STYLE" || child.tagName === "SLOT")
          continue;
        if (shadowChildren.length >= 50)
          break;
        const childNode = buildDomTree(child, options, currentDepth + 1);
        if (childNode) {
          shadowChildren.push(childNode);
        }
      }
      if (shadowChildren.length > 0) {
        node.shadowChildren = shadowChildren;
      }
    }
    if (currentDepth < maxDepth && el.children.length > 0) {
      const children = [];
      let truncatedCount = 0;
      for (const child of el.children) {
        if (children.length >= 50) {
          truncatedCount = el.children.length - children.length;
          break;
        }
        const childNode = buildDomTree(child, options, currentDepth + 1);
        if (childNode) {
          children.push(childNode);
        }
      }
      if (children.length > 0) {
        node.children = children;
      }
      if (truncatedCount > 0) {
        node.truncated = true;
        node.childCount = el.children.length;
      }
    } else if (el.children.length > 0) {
      node.truncated = true;
      node.childCount = el.children.length;
    }
    return node;
  }
  var highlightOverlay = null;
  var highlightLabel = null;
  var highlightStyles = null;
  function createHighlightOverlay() {
    if (highlightOverlay)
      return;
    highlightStyles = document.createElement("style");
    highlightStyles.textContent = `
    :root {
      --tosijs-highlight: #6366f1;
      --tosijs-highlight-bg: rgba(99, 102, 241, 0.1);
      --tosijs-highlight-glow: rgba(99, 102, 241, 0.3);
    }
    
    #haltija-highlight {
      position: fixed;
      pointer-events: none;
      z-index: 999998;
      border: 3px solid var(--tosijs-highlight);
      border-radius: 4px;
      background: var(--tosijs-highlight-bg);
      box-shadow: 0 0 0 4px var(--tosijs-highlight-glow), 0 0 20px var(--tosijs-highlight-glow);
      transition: all 0.15s ease-out;
      display: none;
    }
    
    #haltija-highlight-label {
      position: absolute;
      top: -28px;
      left: -3px;
      background: var(--tosijs-highlight);
      color: white;
      font: 600 11px system-ui, -apple-system, sans-serif;
      padding: 4px 8px;
      border-radius: 4px 4px 0 0;
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;
    document.head.appendChild(highlightStyles);
    highlightOverlay = document.createElement("div");
    highlightOverlay.id = "haltija-highlight";
    highlightLabel = document.createElement("div");
    highlightLabel.id = "haltija-highlight-label";
    highlightOverlay.appendChild(highlightLabel);
    document.body.appendChild(highlightOverlay);
  }
  function showHighlight(el, label, color) {
    createHighlightOverlay();
    if (!highlightOverlay || !highlightLabel)
      return;
    const rect = el.getBoundingClientRect();
    if (color) {
      highlightOverlay.style.setProperty("--tosijs-highlight", color);
      const match = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
      if (match) {
        const r = parseInt(match[1], 16);
        const g = parseInt(match[2], 16);
        const b = parseInt(match[3], 16);
        highlightOverlay.style.setProperty("--tosijs-highlight-bg", `rgba(${r}, ${g}, ${b}, 0.1)`);
        highlightOverlay.style.setProperty("--tosijs-highlight-glow", `rgba(${r}, ${g}, ${b}, 0.3)`);
      }
    } else {
      highlightOverlay.style.removeProperty("--tosijs-highlight");
      highlightOverlay.style.removeProperty("--tosijs-highlight-bg");
      highlightOverlay.style.removeProperty("--tosijs-highlight-glow");
    }
    highlightOverlay.style.display = "block";
    highlightOverlay.style.top = `${rect.top - 3}px`;
    highlightOverlay.style.left = `${rect.left - 3}px`;
    highlightOverlay.style.width = `${rect.width + 6}px`;
    highlightOverlay.style.height = `${rect.height + 6}px`;
    const tagName = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const classes = el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : "";
    highlightLabel.textContent = label || `${tagName}${id}${classes}`;
  }
  function hideHighlight() {
    if (highlightOverlay) {
      highlightOverlay.style.display = "none";
    }
  }
  function pulseHighlight(el, label, color, duration = 2000) {
    showHighlight(el, label, color);
    setTimeout(() => hideHighlight(), duration);
  }
  var currentTagName = TAG_NAME;
  var registrationCount = 0;

  class DevChannel extends HTMLElement {
    static get tagName() {
      return currentTagName;
    }
    static elementCreator() {
      return () => document.createElement(currentTagName);
    }
    ws = null;
    state = "disconnected";
    consoleBuffer = [];
    eventWatchers = new Map;
    mutationObserver = null;
    shadowObservers = new Map;
    mutationDebounceTimer = null;
    pendingMutations = [];
    mutationConfig = null;
    mutationFilterRules = null;
    recording = null;
    testRecording = null;
    originalConsole = {};
    widgetHidden = false;
    serverUrl = "wss://localhost:8700/ws/browser";
    windowId;
    browserId = uid();
    killed = false;
    isActive = true;
    homeLeft = 0;
    homeBottom = 16;
    logPanelOpen = false;
    logAutoScroll = true;
    isRecording = false;
    recordingStartTime = 0;
    recordingEvents = [];
    pending = new Map;
    semanticEventsEnabled = false;
    semanticEventBuffer = [];
    SEMANTIC_BUFFER_MAX = 100;
    semanticSubscription = null;
    SEMANTIC_PRESETS = {
      minimal: ["interaction", "navigation", "recording"],
      interactive: ["interaction", "navigation", "input", "focus", "recording"],
      detailed: ["interaction", "navigation", "input", "focus", "hover", "scroll", "recording"],
      debug: ["interaction", "navigation", "input", "focus", "hover", "scroll", "mutation", "console", "recording"]
    };
    rawEventCounts = {};
    semanticEventCounts = {
      interaction: 0,
      navigation: 0,
      input: 0,
      hover: 0,
      scroll: 0,
      mutation: 0,
      console: 0,
      focus: 0,
      recording: 0
    };
    statsStartTime = 0;
    typingState = { field: null, startTime: 0, text: "", timeout: null };
    TYPING_DEBOUNCE = 500;
    scrollState = { startY: 0, startTime: 0, timeout: null };
    SCROLL_DEBOUNCE = 150;
    hoverState = { element: null, enterTime: 0, timeout: null };
    DWELL_THRESHOLD = 300;
    semanticHandlers = {};
    selectionActive = false;
    selectionStart = null;
    selectionRect = null;
    selectionResult = null;
    selectionOverlay = null;
    selectionBox = null;
    highlightedElements = [];
    static get observedAttributes() {
      return ["server", "hidden"];
    }
    static async runTests() {
      const el = document.querySelector(TAG_NAME);
      if (!el) {
        console.error(`${LOG_PREFIX} No ${TAG_NAME} element found. Inject first.`);
        return { passed: 0, failed: 1, error: `No ${TAG_NAME} element` };
      }
      const results = [];
      const test = (name, fn) => {
        return async () => {
          try {
            await fn();
            results.push({ name, passed: true });
            console.log(`  %c✓ ${name}`, "color: #22c55e");
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            results.push({ name, passed: false, error });
            console.log(`  %c✗ ${name}: ${error}`, "color: #ef4444");
          }
        };
      };
      console.log(`%c${LOG_PREFIX} Running tests...`, "color: #6366f1; font-weight: bold");
      await test("element exists", () => {
        if (!document.querySelector(TAG_NAME))
          throw new Error("Missing");
      })();
      await test("has shadow root", () => {
        if (!el.shadowRoot)
          throw new Error("No shadow root");
      })();
      await test("widget visible", () => {
        const widget = el.shadowRoot?.querySelector(".widget");
        if (!widget)
          throw new Error("No widget");
      })();
      await test("status indicator", () => {
        const status = el.shadowRoot?.querySelector(".status-ring");
        if (!status)
          throw new Error("No status ring");
      })();
      await test("control buttons", () => {
        const btns = el.shadowRoot?.querySelectorAll(".btn");
        if (!btns || btns.length < 3)
          throw new Error(`Expected 3 buttons, got ${btns?.length}`);
      })();
      await test("bookmark link", () => {
        const link = el.shadowRoot?.querySelector('a[href^="javascript:"]');
        if (!link)
          throw new Error("No bookmark link");
      })();
      await test("console interception", async () => {
        const marker = `test-${Date.now()}`;
        const before = el.consoleBuffer.length;
        console.log(marker);
        await new Promise((r) => setTimeout(r, 50));
        if (el.consoleBuffer.length <= before)
          throw new Error("Console not captured");
      })();
      await test("DOM query", () => {
        const body = document.querySelector("body");
        if (!body)
          throw new Error("No body element");
      })();
      await test("connection state valid", () => {
        const valid = ["disconnected", "connecting", "connected", "paused"];
        if (!valid.includes(el.state))
          throw new Error(`Invalid state: ${el.state}`);
      })();
      const passed = results.filter((r) => r.passed).length;
      const failed = results.filter((r) => !r.passed).length;
      const color = failed === 0 ? "#22c55e" : "#ef4444";
      console.log(`%c${LOG_PREFIX} ${passed}/${results.length} tests passed`, `color: ${color}; font-weight: bold`);
      return { passed, failed, results };
    }
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      const WINDOW_ID_KEY = "haltija-window-id";
      let storedWindowId = null;
      try {
        storedWindowId = sessionStorage.getItem(WINDOW_ID_KEY);
        if (!storedWindowId) {
          storedWindowId = uid();
          sessionStorage.setItem(WINDOW_ID_KEY, storedWindowId);
        }
      } catch {
        storedWindowId = uid();
      }
      this.windowId = storedWindowId;
    }
    connectedCallback() {
      this.serverUrl = this.getAttribute("server") || this.serverUrl;
      this.render();
      const rect = this.getBoundingClientRect();
      this.homeLeft = window.innerWidth - rect.width - 16;
      this.homeBottom = 16;
      this.style.left = `${this.homeLeft}px`;
      this.style.bottom = `${this.homeBottom}px`;
      this.setupKeyboardShortcut();
      this.interceptConsole();
      this.connect();
    }
    disconnectedCallback() {
      this.killed = true;
      this.disconnect();
      this.restoreConsole();
      this.clearEventWatchers();
      this.stopMutationWatch();
    }
    attributeChangedCallback(name, _old, value) {
      if (name === "server") {
        this.serverUrl = value;
        if (this.state !== "disconnected") {
          this.disconnect();
          this.connect();
        }
      }
    }
    render() {
      if (this.shadowRoot.querySelector(".widget")) {
        this.updateUI();
        return;
      }
      const shadow = this.shadowRoot;
      shadow.innerHTML = `
      <style>
        :host {
          display: block;
          position: fixed;
          z-index: 999999;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 12px;
        }
        
        :host(.animating-hide) {
          transition: left 0.3s ease-out, bottom 0.3s ease-in;
        }
        
        :host(.animating-show) {
          transition: left 0.3s ease-in, bottom 0.3s ease-out;
        }
        

        
        .widget {
          background: #1a1a2e;
          color: #eee;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          overflow: hidden;
          min-width: 320px;
          transition: all 0.3s ease-out;
        }
        
        :host(.minimized) .widget {
          border-radius: 8px 8px 0 0;
        }
        
        :host(.minimized) .body {
          display: none;
        }
        
        .widget.flash {
          animation: flash 0.5s ease-out;
        }
        
        @keyframes flash {
          0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
          50% { box-shadow: 0 0 30px rgba(99, 102, 241, 0.8); }
        }
        
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #16213e;
          cursor: move;
          user-select: none;
        }
        
        .logo-wrapper {
          position: relative;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .status-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid #666;
        }
        
        .status-ring.connected { border-color: #22c55e; }
        .status-ring.connecting { border-color: #eab308; animation: pulse 1s infinite; }
        .status-ring.paused { border-color: #f97316; }
        .status-ring.disconnected { border-color: #ef4444; }
        
        .logo {
          font-size: 14px;
          line-height: 1;
          z-index: 1;
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .title {
          flex: 1;
          font-weight: 500;
          font-size: 12px;
        }
        
        .indicators {
          display: flex;
          gap: 6px;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 120px;
        }
        
        .indicator {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 500;
          white-space: nowrap;
        }
        
        .indicator.errors {
          background: #ef4444;
          color: white;
          cursor: pointer;
        }
        
        .indicator.errors:hover {
          background: #dc2626;
        }
        
        .indicator.recording {
          background: #ef4444;
          color: white;
          animation: pulse 1s infinite;
        }
        
        .controls {
          display: flex;
          gap: 4px;
        }
        
        .btn {
          background: transparent;
          border: none;
          color: #888;
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          font-size: 14px;
          line-height: 1;
        }
        
        .btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
        .btn.active { color: #6366f1; }
        .btn.danger:hover { color: #ef4444; }
        .btn.recording { color: #ef4444; animation: pulse 1s infinite; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .body {
          padding: 8px 12px;
          font-size: 10px;
          color: #666;
        }
        
        .test-controls {
          display: flex;
          gap: 4px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #333;
        }
        
        .test-btn {
          flex: 1;
          background: #2a2a4a;
          border: 1px solid #444;
          color: #aaa;
          cursor: pointer;
          padding: 6px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        
        .test-btn:hover { background: #3a3a5a; color: #fff; border-color: #666; }
        .test-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .test-btn.recording { background: #4a2a2a; border-color: #ef4444; color: #ef4444; }
        .test-btn.recording:hover { background: #5a3a3a; }
        
        .step-count {
          font-size: 9px;
          color: #888;
          margin-top: 4px;
        }
        
        /* Log Viewer Panel */
        .log-panel {
          display: none;
          border-top: 1px solid #333;
          max-height: 300px;
          overflow: hidden;
          flex-direction: column;
        }
        
        .log-panel.open {
          display: flex;
        }
        
        .log-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          background: #16213e;
          border-bottom: 1px solid #333;
          flex-shrink: 0;
        }
        
        .log-title {
          flex: 1;
          font-size: 10px;
          font-weight: 500;
          color: #888;
        }
        
        .log-filter {
          font-size: 9px;
          padding: 2px 6px;
          background: #2a2a4a;
          border: 1px solid #444;
          border-radius: 4px;
          color: #aaa;
          cursor: pointer;
        }
        
        .log-filter:hover {
          background: #3a3a5a;
          border-color: #666;
        }
        
        .log-scroll-btn {
          font-size: 10px;
          padding: 2px 6px;
          background: transparent;
          border: 1px solid #444;
          border-radius: 4px;
          color: #666;
          cursor: pointer;
        }
        
        .log-scroll-btn.active {
          background: #2a4a2a;
          border-color: #22c55e;
          color: #22c55e;
        }
        
        .log-scroll-btn:hover {
          border-color: #666;
          color: #888;
        }
        
        .log-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          font-family: ui-monospace, monospace;
          font-size: 10px;
        }
        
        .log-empty {
          padding: 20px;
          text-align: center;
          color: #555;
          font-style: italic;
        }
        
        .log-entry {
          border-bottom: 1px solid #222;
        }
        
        .log-entry:hover {
          background: #222;
        }
        
        details.log-entry > summary {
          cursor: pointer;
          list-style: none;
        }
        
        details.log-entry > summary::-webkit-details-marker {
          display: none;
        }
        
        details.log-entry[open] {
          background: #1a1a2e;
        }
        
        .log-entry-main {
          display: flex;
          gap: 8px;
          padding: 4px 12px;
          align-items: baseline;
        }
        
        .log-entry.no-payload .log-entry-main {
          padding: 4px 12px;
        }
        
        .log-time {
          color: #555;
          flex-shrink: 0;
          width: 65px;
        }
        
        .log-cat {
          font-size: 8px;
          padding: 1px 4px;
          border-radius: 3px;
          flex-shrink: 0;
          text-transform: uppercase;
          font-weight: 600;
        }
        
        .log-cat.interaction { background: #3b82f6; color: white; }
        .log-cat.navigation { background: #8b5cf6; color: white; }
        .log-cat.input { background: #22c55e; color: white; }
        .log-cat.hover { background: #f59e0b; color: black; }
        .log-cat.scroll { background: #6b7280; color: white; }
        .log-cat.focus { background: #06b6d4; color: white; }
        .log-cat.mutation { background: #ec4899; color: white; }
        .log-cat.console { background: #ef4444; color: white; }
        .log-cat.error { background: #ef4444; color: white; }
        .log-cat.warn { background: #f59e0b; color: black; }
        .log-cat.log { background: #6b7280; color: white; }
        
        .console-entry.error { border-left: 3px solid #ef4444; }
        .console-entry.warn { border-left: 3px solid #f59e0b; }
        
        .log-console-detail {
          padding: 8px;
          background: #1a1a2e;
        }
        
        .log-console-detail pre {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-all;
          font-size: 10px;
          color: #ccc;
        }
        
        .log-stack {
          margin-top: 8px !important;
          color: #888 !important;
          font-size: 9px !important;
        }
        
        .log-type {
          color: #aaa;
          flex-shrink: 0;
        }
        
        .log-target {
          color: #6366f1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        
        .log-payload-table {
          width: 100%;
          margin: 4px 12px 8px 12px;
          font-size: 9px;
          border-collapse: collapse;
        }
        
        .log-payload-table td {
          padding: 2px 8px 2px 0;
          vertical-align: top;
        }
        
        .log-key {
          color: #888;
          white-space: nowrap;
          width: 1%;
        }
        
        .log-val {
          color: #aaa;
          word-break: break-all;
        }
        
        /* Test output modal */
        .test-modal {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8);
          z-index: 999999;
          justify-content: center;
          align-items: center;
        }
        .test-modal.open { display: flex; }
        .test-modal-content {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
        }
        .test-modal-header {
          padding: 12px 16px;
          border-bottom: 1px solid #333;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .test-modal-header h3 {
          margin: 0;
          font-size: 14px;
          color: #fff;
        }
        .test-modal-body {
          padding: 16px;
          overflow: auto;
          flex: 1;
        }
        .test-modal-body input {
          width: calc(100% - 16px);
          padding: 8px;
          margin-bottom: 12px;
          background: #222;
          border: 1px solid #444;
          border-radius: 4px;
          color: #fff;
          font-size: 13px;
        }
        .test-modal-body textarea {
          width: calc(100% - 16px);
          height: 200px;
          padding: 8px;
          background: #111;
          border: 1px solid #333;
          border-radius: 4px;
          color: #0f0;
          font-family: monospace;
          font-size: 11px;
          resize: vertical;
        }
        .test-modal-footer {
          padding: 12px 16px;
          border-top: 1px solid #333;
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          align-items: center;
        }
        .test-modal-footer button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }
        .test-modal-footer .btn-primary {
          background: #6366f1;
          color: #fff;
        }
        .test-modal-footer .btn-primary:hover {
          background: #4f46e5;
        }
        .test-modal-footer .btn-secondary {
          background: #333;
          color: #fff;
        }
        .test-modal-footer .btn-secondary:hover {
          background: #444;
        }
        .test-modal .success-msg {
          color: #22c55e;
          font-size: 11px;
          flex: 1;
        }
        .test-modal-footer .btn-cancel {
          background: transparent;
          border: 1px solid #444;
          color: #888;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-right: auto;
        }
        .test-modal-footer .btn-cancel:hover {
          background: #222;
          color: #fff;
          border-color: #666;
        }
      </style>
      
      <div class="widget">
        <div class="header">
          <div class="logo-wrapper">
            <div class="status-ring"></div>
            <span class="logo">\uD83E\uDDDD</span>
          </div>
          <div class="title">${PRODUCT_NAME}</div>
          <div class="indicators"></div>
          <div class="controls">
            <button class="btn" data-action="select" title="Select elements (drag to select area)" aria-label="Select elements">\uD83D\uDC46</button>
            <button class="btn" data-action="record" title="Record test (click to start/stop)" aria-label="Record test">\uD83C\uDFAC</button>
            <button class="btn" data-action="logs" title="Show event log panel" aria-label="Toggle event log">\uD83D\uDCCB</button>
            <button class="btn" data-action="minimize" title="Minimize widget (⌥Tab)" aria-label="Minimize">─</button>
            <button class="btn danger" data-action="kill" title="Close and disconnect" aria-label="Close widget">✕</button>
          </div>
        </div>
        <div class="body">
            <a href="javascript:(function(){fetch('${this.serverUrl.replace("ws:", "http:").replace("wss:", "https:").replace("/ws/browser", "")}/inject.js').then(r=>r.text()).then(eval).catch(e=>alert('${PRODUCT_NAME}: Cannot reach server'))})();" 
               style="color: #6366f1; text-decoration: none;"
               title="Drag to bookmarks bar"
               class="bookmark-link">\uD83E\uDDDD bookmark</a>
        </div>
        <div class="log-panel">
          <div class="log-header">
            <span class="log-title">Events</span>
            <select class="log-filter" title="Filter events by category" aria-label="Event category filter">
              <option value="all">All</option>
              <option value="interaction">Clicks</option>
              <option value="input">Input</option>
              <option value="navigation">Nav</option>
              <option value="hover">Hover</option>
              <option value="focus">Focus</option>
              <option value="console">Console</option>
            </select>
            <button class="log-scroll-btn active" title="Auto-scroll to new events (click to toggle)" aria-label="Toggle auto-scroll">⤓</button>
            <button class="btn" data-action="clear-logs" title="Clear all events" aria-label="Clear event log">\uD83D\uDDD1</button>
          </div>
          <div class="log-content">
            <div class="log-empty">No events yet. Events will appear when semantic event watching is active.</div>
          </div>
        </div>
      </div>
      
      <div class="test-modal">
        <div class="test-modal-content">
          <div class="test-modal-header">
            <h3>Name and Save Your Test</h3>
            <button class="btn" data-action="close-modal" title="Close">✕</button>
          </div>
          <div class="test-modal-body">
            <input type="text" class="test-name" placeholder="Enter test name..." value="">
            <textarea class="test-json" readonly></textarea>
          </div>
          <div class="test-modal-footer">
            <button class="btn-cancel" data-action="close-modal">Cancel</button>
            <span class="success-msg"></span>
            <button class="btn-secondary" data-action="download-test">\uD83D\uDCBE Save</button>
            <button class="btn-primary" data-action="copy-test">\uD83D\uDCCB Copy</button>
          </div>
        </div>
      </div>
    `;
      this.updateUI();
      shadow.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("mousedown", (e) => {
          e.stopPropagation();
        });
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const action2 = e.currentTarget.dataset.action;
          if (action2 === "minimize")
            this.toggleMinimize();
          if (action2 === "kill")
            this.kill();
          if (action2 === "logs")
            this.toggleLogPanel();
          if (action2 === "clear-logs")
            this.clearLogPanel();
          if (action2 === "record")
            this.toggleRecording();
          if (action2 === "select")
            this.startSelection();
          if (action2 === "close-modal")
            this.closeTestModal();
          if (action2 === "copy-test")
            this.copyTest();
          if (action2 === "download-test")
            this.downloadTest();
        });
      });
      const indicators = shadow.querySelector(".indicators");
      if (indicators) {
        indicators.addEventListener("click", (e) => {
          const target = e.target;
          if (target.classList.contains("errors")) {
            const logFilter2 = shadow.querySelector(".log-filter");
            if (logFilter2) {
              logFilter2.value = "console";
            }
            if (!this.logPanelOpen) {
              this.toggleLogPanel();
            } else {
              this.updateLogPanel();
            }
          }
        });
      }
      const logFilter = shadow.querySelector(".log-filter");
      if (logFilter) {
        logFilter.addEventListener("change", () => this.updateLogPanel());
      }
      const logScrollBtn = shadow.querySelector(".log-scroll-btn");
      if (logScrollBtn) {
        logScrollBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.logAutoScroll = !this.logAutoScroll;
          logScrollBtn.classList.toggle("active", this.logAutoScroll);
          if (this.logAutoScroll) {
            this.scrollLogToBottom();
          }
        });
      }
      const logContent = shadow.querySelector(".log-content");
      if (logContent) {
        logContent.addEventListener("scroll", () => {
          const el = logContent;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
          if (!atBottom && this.logAutoScroll) {
            this.logAutoScroll = false;
            shadow.querySelector(".log-scroll-btn")?.classList.remove("active");
          }
        });
      }
      const bookmarkLink = shadow.querySelector(".bookmark-link");
      if (bookmarkLink) {
        bookmarkLink.addEventListener("mouseenter", () => {
          bookmarkLink.textContent = `\uD83E\uDDDD ${PRODUCT_NAME}`;
        });
        bookmarkLink.addEventListener("mouseleave", () => {
          bookmarkLink.textContent = "\uD83E\uDDDD bookmark";
        });
      }
      this.setupDrag(shadow.querySelector(".header"));
    }
    updateUI() {
      const shadow = this.shadowRoot;
      const statusRing = shadow.querySelector(".status-ring");
      if (statusRing) {
        statusRing.className = `status-ring ${this.state}`;
      }
      const indicators = shadow.querySelector(".indicators");
      if (indicators) {
        const errorCount = this.consoleBuffer.filter((e) => e.level === "error").length;
        let html = "";
        if (errorCount > 0) {
          html += `<span class="indicator errors" title="${errorCount} error${errorCount > 1 ? "s" : ""}">${errorCount} ⚠</span>`;
        }
        if (this.recording) {
          html += `<span class="indicator recording">REC</span>`;
        }
        indicators.innerHTML = html;
      }
      const logBtn = shadow.querySelector('[data-action="logs"]');
      if (logBtn) {
        logBtn.classList.toggle("active", this.logPanelOpen);
      }
    }
    toggleLogPanel() {
      this.logPanelOpen = !this.logPanelOpen;
      const panel = this.shadowRoot?.querySelector(".log-panel");
      if (panel) {
        panel.classList.toggle("open", this.logPanelOpen);
        if (this.logPanelOpen) {
          if (!this.semanticEventsEnabled) {
            this.semanticSubscription = { preset: "interactive" };
            this.startSemanticEvents();
          }
          this.updateLogPanel();
          if (this.logAutoScroll) {
            this.scrollLogToBottom();
          }
          requestAnimationFrame(() => this.ensureOnScreen());
        } else {
          if (this.semanticEventsEnabled && this.semanticSubscription?.preset === "interactive") {
            this.stopSemanticEvents();
            this.semanticSubscription = null;
          }
        }
      }
      this.updateUI();
    }
    ensureOnScreen() {
      const rect = this.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      let newBottom = parseInt(this.style.bottom) || 16;
      let newLeft = parseInt(this.style.left) || this.homeLeft;
      if (rect.top < 0) {
        newBottom = viewportHeight - rect.height - 8;
      }
      if (rect.bottom > viewportHeight) {
        newBottom = 8;
      }
      if (rect.right > viewportWidth) {
        newLeft = viewportWidth - rect.width - 8;
      }
      if (rect.left < 0) {
        newLeft = 8;
      }
      this.style.bottom = `${newBottom}px`;
      this.style.left = `${newLeft}px`;
    }
    clearLogPanel() {
      this.semanticEventBuffer.length = 0;
      this.updateLogPanel();
    }
    scrollLogToBottom() {
      const content = this.shadowRoot?.querySelector(".log-content");
      if (content) {
        content.scrollTop = content.scrollHeight;
      }
    }
    updateLogPanel() {
      const content = this.shadowRoot?.querySelector(".log-content");
      if (!content)
        return;
      const filter = this.shadowRoot?.querySelector(".log-filter")?.value || "all";
      if (filter === "console") {
        if (this.consoleBuffer.length === 0) {
          content.innerHTML = `<div class="log-empty">No console messages captured.</div>`;
          return;
        }
        content.innerHTML = this.consoleBuffer.map((entry) => {
          const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            fractionalSecondDigits: 1
          });
          const levelClass = entry.level === "error" ? "error" : entry.level === "warn" ? "warn" : "log";
          const args = entry.args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
          const displayArgs = args.length > 100 ? args.slice(0, 100) + "…" : args;
          return `
          <details class="log-entry console-entry ${levelClass}" data-ts="${entry.timestamp}">
            <summary class="log-entry-main">
              <span class="log-time">${time}</span>
              <span class="log-cat ${levelClass}">${entry.level.slice(0, 3)}</span>
              <span class="log-type">console.${entry.level}</span>
              <span class="log-target" title="${this.escapeHtml(args)}">${this.escapeHtml(displayArgs)}</span>
            </summary>
            <div class="log-console-detail">
              <pre>${this.escapeHtml(args)}</pre>
              ${entry.stack ? `<pre class="log-stack">${this.escapeHtml(entry.stack)}</pre>` : ""}
            </div>
          </details>
        `;
        }).join("");
        if (this.logAutoScroll) {
          this.scrollLogToBottom();
        }
        return;
      }
      const events = filter === "all" ? this.semanticEventBuffer : this.semanticEventBuffer.filter((e) => e.category === filter);
      if (events.length === 0) {
        content.innerHTML = `<div class="log-empty">No events yet. Interact with the page to see events.</div>`;
        return;
      }
      content.innerHTML = events.map((event) => {
        const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 1
        });
        const target = event.target ? event.target.label || event.target.text || event.target.selector || event.target.tag : "";
        const payloadEntries = Object.entries(event.payload).filter(([_, v]) => v != null && v !== "");
        const hasPayload = payloadEntries.length > 0;
        const payloadTable = hasPayload ? `
        <table class="log-payload-table">
          ${payloadEntries.map(([k, v]) => {
          const val = typeof v === "object" ? JSON.stringify(v) : String(v);
          const displayVal = val.length > 60 ? val.slice(0, 60) + "…" : val;
          return `<tr><td class="log-key">${this.escapeHtml(k)}</td><td class="log-val" title="${this.escapeHtml(val)}">${this.escapeHtml(displayVal)}</td></tr>`;
        }).join("")}
        </table>
      ` : "";
        if (hasPayload) {
          return `
          <details class="log-entry" data-ts="${event.timestamp}">
            <summary class="log-entry-main">
              <span class="log-time">${time}</span>
              <span class="log-cat ${event.category}">${event.category.slice(0, 3)}</span>
              <span class="log-type">${event.type}</span>
              <span class="log-target" title="${this.escapeHtml(target)}">${this.escapeHtml(target)}</span>
            </summary>
            ${payloadTable}
          </details>
        `;
        } else {
          return `
          <div class="log-entry no-payload" data-ts="${event.timestamp}">
            <div class="log-entry-main">
              <span class="log-time">${time}</span>
              <span class="log-cat ${event.category}">${event.category.slice(0, 3)}</span>
              <span class="log-type">${event.type}</span>
              <span class="log-target" title="${this.escapeHtml(target)}">${this.escapeHtml(target)}</span>
            </div>
          </div>
        `;
        }
      }).join("");
      if (this.logAutoScroll) {
        this.scrollLogToBottom();
      }
    }
    escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    toggleRecording() {
      if (this.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording();
      }
    }
    startRecording() {
      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.recordingEvents = [];
      if (!this.semanticEventsEnabled) {
        this.semanticSubscription = { preset: "interactive" };
        this.startSemanticEvents();
      }
      this.emitSemanticEvent({
        type: "recording:started",
        timestamp: this.recordingStartTime,
        category: "recording",
        target: { selector: "document", tag: "document" },
        payload: {
          url: window.location.href,
          title: document.title
        }
      });
      const recordBtn = this.shadowRoot?.querySelector('[data-action="record"]');
      if (recordBtn) {
        recordBtn.textContent = "\uD83D\uDCBE";
        recordBtn.classList.add("recording");
        recordBtn.setAttribute("title", "Stop recording (click to finish)");
      }
    }
    stopRecording() {
      this.isRecording = false;
      const stopTime = Date.now();
      this.recordingEvents = this.semanticEventBuffer.filter((e) => e.timestamp >= this.recordingStartTime);
      const recordingId = `rec_${this.recordingStartTime}_${Math.random().toString(36).slice(2, 8)}`;
      this.emitSemanticEvent({
        type: "recording:stopped",
        timestamp: stopTime,
        category: "recording",
        target: { selector: "document", tag: "document" },
        payload: {
          id: recordingId,
          url: window.location.href,
          title: document.title,
          startTime: this.recordingStartTime,
          endTime: stopTime,
          duration: stopTime - this.recordingStartTime,
          eventCount: this.recordingEvents.length
        }
      });
      this.saveRecordingToServer(recordingId, stopTime);
      const recordBtn = this.shadowRoot?.querySelector('[data-action="record"]');
      if (recordBtn) {
        recordBtn.textContent = "\uD83C\uDFAC";
        recordBtn.classList.remove("recording");
        recordBtn.setAttribute("title", "Record test (click to start)");
      }
      this.generateAndShowTest();
    }
    saveRecordingToServer(recordingId, endTime) {
      this.send("recording", "save", {
        id: recordingId,
        url: window.location.href,
        title: document.title,
        startTime: this.recordingStartTime,
        endTime,
        events: this.recordingEvents
      });
    }
    generateAndShowTest() {
      const test = this.eventsToTest(this.recordingEvents, {
        name: "",
        url: window.location.href,
        addAssertions: true
      });
      const modal = this.shadowRoot?.querySelector(".test-modal");
      const nameInput = this.shadowRoot?.querySelector(".test-name");
      const jsonArea = this.shadowRoot?.querySelector(".test-json");
      const successMsg = this.shadowRoot?.querySelector(".success-msg");
      if (modal && nameInput && jsonArea) {
        nameInput.value = "";
        jsonArea.value = JSON.stringify(test, null, 2);
        modal.classList.add("open");
        setTimeout(() => nameInput.focus(), 100);
        if (successMsg)
          successMsg.textContent = "";
        nameInput.oninput = () => {
          test.name = nameInput.value;
          jsonArea.value = JSON.stringify(test, null, 2);
        };
      }
    }
    cleanDescription(text, maxLen = 30) {
      if (!text)
        return "";
      return text.replace(/\s+/g, " ").trim().slice(0, maxLen) + (text.length > maxLen ? "..." : "");
    }
    eventsToTest(events, options) {
      const steps = [];
      let prevTimestamp = events[0]?.timestamp || Date.now();
      for (let i = 0;i < events.length; i++) {
        const event = events[i];
        const delay = i > 0 ? Math.min(event.timestamp - prevTimestamp, 5000) : undefined;
        prevTimestamp = event.timestamp;
        const selector = event.target?.selector || "";
        const text = event.target?.text || event.target?.label || "";
        switch (event.type) {
          case "interaction:click":
            const clickText = this.cleanDescription(text);
            steps.push({
              action: "click",
              selector,
              description: clickText ? `Click "${clickText}"` : `Click ${selector}`,
              ...delay && delay > 50 ? { delay } : {}
            });
            const nextEvent = events[i + 1];
            if (nextEvent?.type === "navigation:navigate" && options.addAssertions) {
              steps.push({
                action: "assert",
                assertion: { type: "url", pattern: nextEvent.payload?.url || "" },
                description: `Verify navigation to ${nextEvent.payload?.url}`
              });
              i++;
            }
            break;
          case "input:typed":
          case "input:cleared":
          case "input:changed":
          case "input:checked":
            const inputValue = event.payload?.text ?? event.payload?.value ?? "";
            const inputType = event.payload?.fieldType || event.target?.tag || "input";
            const inputLabel = this.cleanDescription(event.target?.label || inputType);
            const isCleared = event.type === "input:cleared" || inputValue === "";
            let inputAction = "type";
            let inputDesc = "";
            if (isCleared) {
              inputDesc = `Clear ${inputLabel}`;
            } else if (inputType === "range") {
              inputAction = "set";
              inputDesc = `Set ${inputLabel} to ${inputValue}`;
            } else if (inputType === "select-one" || inputType === "select-multiple") {
              inputAction = "select";
              inputDesc = `Select "${inputValue}" in ${inputLabel}`;
            } else if (inputType === "checkbox" || inputType === "radio") {
              inputAction = "check";
              inputDesc = `Check ${inputLabel}`;
            } else if (inputType === "date" || inputType === "time" || inputType === "color") {
              inputAction = "set";
              inputDesc = `Set ${inputLabel} to ${inputValue}`;
            } else {
              inputDesc = `Type "${inputValue}" in ${inputLabel}`;
            }
            steps.push({
              action: inputAction,
              selector,
              ...inputAction === "type" || inputAction === "set" ? { text: inputValue } : { value: inputValue },
              description: inputDesc,
              ...delay && delay > 50 ? { delay } : {}
            });
            if (options.addAssertions && inputValue) {
              steps.push({
                action: "assert",
                assertion: { type: "value", selector, expected: inputValue },
                description: `Verify ${inputLabel} is "${inputValue}"`
              });
            }
            break;
          case "navigation:navigate":
            if (event.payload?.trigger !== "click" && event.payload?.trigger !== "submit" && event.payload?.trigger !== "initial") {
              const navUrl = event.payload?.url || event.payload?.to || "";
              steps.push({
                action: "navigate",
                url: navUrl,
                description: `Navigate to ${navUrl}`
              });
            }
            break;
          case "interaction:submit":
            steps.push({
              action: "click",
              selector: event.target?.selector || 'button[type="submit"]',
              description: `Submit form`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
          case "interaction:select":
            const selectedText = this.cleanDescription(event.payload?.text || "", 50);
            steps.push({
              action: "select",
              selector,
              text: event.payload?.text || "",
              description: `Select text "${selectedText}"`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
          case "interaction:cut":
            const cutText = this.cleanDescription(event.payload?.text || "", 50);
            steps.push({
              action: "cut",
              selector,
              text: event.payload?.text || "",
              description: `Cut "${cutText}"`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
          case "interaction:copy":
            const copyText = this.cleanDescription(event.payload?.text || "", 50);
            steps.push({
              action: "copy",
              selector,
              text: event.payload?.text || "",
              description: `Copy "${copyText}"`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
          case "interaction:paste":
            const pasteText = this.cleanDescription(event.payload?.text || "", 50);
            steps.push({
              action: "paste",
              selector,
              text: event.payload?.text || "",
              description: `Paste "${pasteText}"`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
          case "input:newline":
            steps.push({
              action: "key",
              selector,
              key: "Enter",
              description: `Press Enter`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
          case "input:escape":
            steps.push({
              action: "key",
              selector,
              key: "Escape",
              description: `Press Escape`,
              ...delay && delay > 50 ? { delay } : {}
            });
            break;
        }
      }
      return {
        version: 1,
        name: options.name,
        url: options.url,
        createdAt: Date.now(),
        createdBy: "human",
        steps
      };
    }
    closeTestModal() {
      const modal = this.shadowRoot?.querySelector(".test-modal");
      if (modal) {
        modal.classList.remove("open");
      }
    }
    copyTest() {
      const jsonArea = this.shadowRoot?.querySelector(".test-json");
      const successMsg = this.shadowRoot?.querySelector(".success-msg");
      if (jsonArea) {
        navigator.clipboard.writeText(jsonArea.value).then(() => {
          if (successMsg) {
            successMsg.textContent = "Copied!";
            setTimeout(() => {
              successMsg.textContent = "";
            }, 2000);
          }
        });
      }
    }
    downloadTest() {
      const nameInput = this.shadowRoot?.querySelector(".test-name");
      const jsonArea = this.shadowRoot?.querySelector(".test-json");
      const successMsg = this.shadowRoot?.querySelector(".success-msg");
      if (!nameInput?.value.trim()) {
        if (successMsg) {
          successMsg.textContent = "Please enter a test name";
          successMsg.style.color = "#ef4444";
          setTimeout(() => {
            successMsg.textContent = "";
            successMsg.style.color = "";
          }, 2000);
        }
        nameInput?.focus();
        return;
      }
      if (jsonArea && nameInput) {
        const testData = JSON.parse(jsonArea.value);
        testData.name = nameInput.value.trim();
        const updatedJson = JSON.stringify(testData, null, 2);
        const filename = nameInput.value.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + ".test.json";
        const blob = new Blob([updatedJson], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        if (successMsg) {
          successMsg.textContent = `Saved as ${filename}`;
          setTimeout(() => {
            successMsg.textContent = "";
          }, 3000);
        }
      }
    }
    startSelection() {
      if (this.selectionActive) {
        this.cancelSelection();
        return;
      }
      this.selectionActive = true;
      this.selectionResult = null;
      const selectBtn = this.shadowRoot?.querySelector('[data-action="select"]');
      if (selectBtn) {
        selectBtn.classList.add("active");
        selectBtn.setAttribute("title", "Cancel selection (click or Esc)");
      }
      this.selectionOverlay = document.createElement("div");
      this.selectionOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.1);
      cursor: crosshair;
      z-index: 2147483645;
    `;
      this.selectionBox = document.createElement("div");
      this.selectionBox.style.cssText = `
      position: fixed;
      border: 2px dashed #6366f1;
      background: rgba(99, 102, 241, 0.1);
      pointer-events: none;
      z-index: 2147483646;
      display: none;
    `;
      document.body.appendChild(this.selectionOverlay);
      document.body.appendChild(this.selectionBox);
      const onMouseDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectionStart = { x: e.clientX, y: e.clientY };
        this.selectionBox.style.display = "block";
        this.selectionBox.style.left = `${e.clientX}px`;
        this.selectionBox.style.top = `${e.clientY}px`;
        this.selectionBox.style.width = "0";
        this.selectionBox.style.height = "0";
      };
      const onMouseMove = (e) => {
        if (!this.selectionStart)
          return;
        const x = Math.min(this.selectionStart.x, e.clientX);
        const y = Math.min(this.selectionStart.y, e.clientY);
        const width = Math.abs(e.clientX - this.selectionStart.x);
        const height = Math.abs(e.clientY - this.selectionStart.y);
        this.selectionBox.style.left = `${x}px`;
        this.selectionBox.style.top = `${y}px`;
        this.selectionBox.style.width = `${width}px`;
        this.selectionBox.style.height = `${height}px`;
        this.selectionRect = { x, y, width, height };
        this.updateSelectionHighlights();
      };
      const onMouseUp = (e) => {
        if (!this.selectionStart || !this.selectionRect) {
          this.cancelSelection();
          return;
        }
        this.finalizeSelection();
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          this.cancelSelection();
        }
      };
      this.selectionOverlay.addEventListener("mousedown", onMouseDown);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("keydown", onKeyDown);
      this.selectionOverlay._cleanup = () => {
        this.selectionOverlay?.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.removeEventListener("keydown", onKeyDown);
      };
    }
    updateSelectionHighlights() {
      this.clearHighlights();
      if (!this.selectionRect || this.selectionRect.width < 5 || this.selectionRect.height < 5) {
        return;
      }
      const elements = this.getElementsInRect(this.selectionRect);
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        const highlight = document.createElement("div");
        highlight.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        border: 2px solid #ef4444;
        background: rgba(239, 68, 68, 0.15);
        pointer-events: none;
        z-index: 2147483646;
        box-sizing: border-box;
      `;
        document.body.appendChild(highlight);
        this.highlightedElements.push(highlight);
      }
    }
    getElementsInRect(rect) {
      const elements = [];
      const allElements = document.body.querySelectorAll("*");
      for (const el of allElements) {
        if (el.closest(TAG_NAME))
          continue;
        const elRect = el.getBoundingClientRect();
        if (elRect.width === 0 || elRect.height === 0)
          continue;
        const enclosed = elRect.left >= rect.x && elRect.right <= rect.x + rect.width && elRect.top >= rect.y && elRect.bottom <= rect.y + rect.height;
        if (enclosed) {
          elements.push(el);
        }
      }
      return elements;
    }
    clearHighlights() {
      for (const highlight of this.highlightedElements) {
        highlight.remove();
      }
      this.highlightedElements = [];
    }
    async finalizeSelection() {
      if (!this.selectionRect) {
        this.cancelSelection();
        return;
      }
      const elements = this.getElementsInRect(this.selectionRect);
      this.selectionResult = {
        region: { ...this.selectionRect },
        elements: elements.map((el) => {
          const rect = el.getBoundingClientRect();
          const attrs = {};
          for (const attr of el.attributes) {
            attrs[attr.name] = attr.value;
          }
          return {
            selector: getSelector(el),
            tagName: el.tagName.toLowerCase(),
            text: (el.textContent || "").trim().slice(0, 200),
            html: el.outerHTML.slice(0, 500),
            rect: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            attributes: attrs
          };
        }),
        timestamp: Date.now()
      };
      this.send("selection", "completed", this.selectionResult);
      console.log(`${LOG_PREFIX} Selection completed: ${elements.length} elements`);
      this.selectionOverlay?.remove();
      this.selectionBox?.remove();
      this.selectionOverlay = null;
      this.selectionBox = null;
      this.selectionActive = false;
      this.selectionStart = null;
      this.selectionRect = null;
      const selectBtn = this.shadowRoot?.querySelector('[data-action="select"]');
      if (selectBtn) {
        selectBtn.classList.remove("active");
        selectBtn.setAttribute("title", "Select elements (drag to select area)");
      }
      setTimeout(() => {
        this.clearHighlights();
      }, 2000);
    }
    cancelSelection() {
      if (this.selectionOverlay?._cleanup) {
        this.selectionOverlay._cleanup();
      }
      this.selectionOverlay?.remove();
      this.selectionBox?.remove();
      this.clearHighlights();
      this.selectionOverlay = null;
      this.selectionBox = null;
      this.selectionActive = false;
      this.selectionStart = null;
      this.selectionRect = null;
      const selectBtn = this.shadowRoot?.querySelector('[data-action="select"]');
      if (selectBtn) {
        selectBtn.classList.remove("active");
        selectBtn.setAttribute("title", "Select elements (drag to select area)");
      }
    }
    getSelectionResult() {
      return this.selectionResult;
    }
    clearSelection() {
      this.selectionResult = null;
      this.clearHighlights();
    }
    setupDrag(handle) {
      let startX = 0, startY = 0, startLeft = 0, startBottom = 0;
      const onMouseMove = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        this.style.left = `${startLeft + dx}px`;
        this.style.bottom = `${startBottom - dy}px`;
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        if (!this.classList.contains("minimized")) {
          const rect = this.getBoundingClientRect();
          this.homeLeft = rect.left;
          this.homeBottom = window.innerHeight - rect.bottom;
        }
      };
      handle.addEventListener("mousedown", (e) => {
        const me = e;
        startX = me.clientX;
        startY = me.clientY;
        const rect = this.getBoundingClientRect();
        startLeft = rect.left;
        startBottom = window.innerHeight - rect.bottom;
        if (this.classList.contains("minimized")) {
          this.classList.remove("minimized");
        }
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }
    setupKeyboardShortcut() {
      document.addEventListener("keydown", (e) => {
        if (e.altKey && e.key === "Tab") {
          e.preventDefault();
          this.toggleMinimize();
        }
      });
    }
    flash() {
      const widget = this.shadowRoot?.querySelector(".widget");
      widget?.classList.add("flash");
      setTimeout(() => widget?.classList.remove("flash"), 500);
    }
    show() {
      this.widgetHidden = false;
      this.render();
      this.flash();
    }
    toggleHidden() {
      this.widgetHidden = !this.widgetHidden;
      this.render();
    }
    toggleMinimize() {
      const isMinimized = this.classList.contains("minimized");
      const rect = this.getBoundingClientRect();
      const currentLeft = rect.left;
      const currentBottom = window.innerHeight - rect.bottom;
      if (isMinimized) {
        this.style.left = `${currentLeft}px`;
        this.style.bottom = `${currentBottom}px`;
        this.classList.remove("minimized");
        this.offsetHeight;
        this.classList.add("animating-show");
        this.style.left = `${this.homeLeft}px`;
        this.style.bottom = `${this.homeBottom}px`;
        setTimeout(() => this.classList.remove("animating-show"), 350);
      } else {
        this.homeLeft = currentLeft;
        this.homeBottom = currentBottom;
        this.style.left = `${currentLeft}px`;
        this.style.bottom = `${currentBottom}px`;
        this.offsetHeight;
        this.classList.add("animating-hide");
        this.style.left = "16px";
        this.style.bottom = "0px";
        this.classList.add("minimized");
        setTimeout(() => this.classList.remove("animating-hide"), 350);
      }
    }
    togglePause() {
      if (this.state === "paused") {
        this.state = "connected";
        this.show();
      } else if (this.state === "connected") {
        this.state = "paused";
        hideHighlight();
        this.stopMutationWatch();
      }
      this.render();
    }
    kill() {
      this.killed = true;
      hideHighlight();
      this.restoreConsole();
      this.clearEventWatchers();
      this.stopMutationWatch();
      this.stopTestRecording();
      this.disconnect();
      this.remove();
    }
    testRecordingHandler = null;
    toggleTestRecording() {
      if (this.testRecording) {
        this.stopTestRecording();
      } else {
        this.startTestRecording();
      }
      this.render();
    }
    startTestRecording() {
      this.testRecording = {
        steps: [],
        startUrl: location.href,
        startTime: Date.now()
      };
      this.testRecordingHandler = (e) => {
        if (!this.testRecording)
          return;
        const target = e.target;
        if (!target || target.closest(TAG_NAME))
          return;
        const step = this.eventToTestStep(e);
        if (step) {
          this.testRecording.steps.push(step);
          this.render();
          this.send("test-recording", "step", {
            index: this.testRecording.steps.length - 1,
            step
          });
        }
      };
      document.addEventListener("click", this.testRecordingHandler, true);
      document.addEventListener("input", this.testRecordingHandler, true);
      document.addEventListener("change", this.testRecordingHandler, true);
      document.addEventListener("submit", this.testRecordingHandler, true);
      this.send("test-recording", "started", { url: location.href });
    }
    stopTestRecording() {
      if (this.testRecordingHandler) {
        document.removeEventListener("click", this.testRecordingHandler, true);
        document.removeEventListener("input", this.testRecordingHandler, true);
        document.removeEventListener("change", this.testRecordingHandler, true);
        document.removeEventListener("submit", this.testRecordingHandler, true);
        this.testRecordingHandler = null;
      }
      if (this.testRecording) {
        this.send("test-recording", "stopped", {
          stepCount: this.testRecording.steps.length
        });
      }
    }
    getBestSelector(el) {
      const tag = el.tagName.toLowerCase();
      const htmlEl = el;
      if (el.id && !el.id.match(/^(ember|react|vue|ng-|:r|:R|\d)/)) {
        return `#${el.id}`;
      }
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) {
        return `${tag}[aria-label="${ariaLabel.slice(0, 40)}"]`;
      }
      const title = el.getAttribute("title");
      if (title) {
        return `${tag}[title="${title.slice(0, 40)}"]`;
      }
      if (el.matches("input, select, textarea")) {
        const input = el;
        const labelFor = input.id && document.querySelector(`label[for="${input.id}"]`);
        if (labelFor) {
          const labelText = labelFor.innerText?.trim().slice(0, 30);
          if (labelText) {
            return `${tag} labeled "${labelText}"`;
          }
        }
        const parentLabel = el.closest("label");
        if (parentLabel) {
          const labelText = parentLabel.innerText?.trim().slice(0, 30);
          if (labelText) {
            return `${tag} labeled "${labelText}"`;
          }
        }
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const labelEl = document.getElementById(labelledBy);
          if (labelEl) {
            return `${tag} labeled "${labelEl.innerText?.trim().slice(0, 30)}"`;
          }
        }
        if (input.placeholder) {
          return `${tag}[placeholder="${input.placeholder.slice(0, 30)}"]`;
        }
      }
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-test-id");
      if (testId) {
        return `[data-testid="${testId}"]`;
      }
      const name = el.getAttribute("name");
      if (name && el.matches("input, select, textarea, button")) {
        return `${tag}[name="${name}"]`;
      }
      const role = el.getAttribute("role");
      if (role) {
        const accName = ariaLabel || htmlEl.innerText?.trim().slice(0, 30);
        if (accName) {
          return `${role} "${accName}"`;
        }
        return `[role="${role}"]`;
      }
      if (el.matches("main, nav, header, footer, aside, article, section")) {
        const heading = el.querySelector("h1, h2, h3, h4");
        if (heading) {
          const headingText = heading.innerText?.trim().slice(0, 30);
          if (headingText) {
            return `${tag} "${headingText}"`;
          }
        }
        return tag;
      }
      if (tag === "button" || tag === "a") {
        const text = htmlEl.innerText?.trim();
        if (text && text.length < 50 && !text.includes(`
`)) {
          return `${tag} "${text.slice(0, 30)}"`;
        }
        if (tag === "a") {
          const href = el.getAttribute("href");
          if (href && !href.startsWith("javascript:")) {
            return `link to "${href.slice(0, 40)}"`;
          }
        }
      }
      if (tag === "img") {
        const alt = el.getAttribute("alt");
        if (alt) {
          return `img "${alt.slice(0, 40)}"`;
        }
      }
      const classList = Array.from(el.classList).filter((c) => !c.match(/^(p|m|w|h|text|bg|flex|grid|hidden|block|inline|absolute|relative|overflow|cursor|transition|transform|opacity|z-)-/) && !c.match(/^-?xin-/) && !c.match(/^(ng-|ember-|react-|vue-)/) && c.length > 2);
      if (classList.length > 0) {
        const selector = `${tag}.${classList.slice(0, 2).join(".")}`;
        if (document.querySelectorAll(selector).length === 1) {
          return selector;
        }
      }
      const landmark = el.closest("main, nav, header, footer, aside, article, section, form");
      if (landmark && landmark !== el) {
        const landmarkDesc = this.getBestSelector(landmark);
        const siblings = Array.from(landmark.querySelectorAll(tag));
        const index = siblings.indexOf(el);
        if (siblings.length === 1) {
          return `${tag} in ${landmarkDesc}`;
        } else if (index >= 0) {
          return `${tag}[${index + 1}] in ${landmarkDesc}`;
        }
      }
      return getSelector(el);
    }
    eventToTestStep(e) {
      const target = e.target;
      const selector = this.getBestSelector(target);
      if (e.type === "click") {
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
          return null;
        }
        return {
          action: "click",
          selector,
          description: this.describeElement(target)
        };
      }
      if (e.type === "input" || e.type === "change") {
        const inputEl = target;
        if (this.testRecording && this.testRecording.steps.length > 0) {
          const lastStep = this.testRecording.steps[this.testRecording.steps.length - 1];
          if (lastStep.action === "type" && lastStep.selector === selector) {
            lastStep.text = inputEl.value;
            return null;
          }
        }
        return {
          action: "type",
          selector,
          text: inputEl.value,
          description: this.describeElement(target)
        };
      }
      if (e.type === "submit") {
        const form = target;
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        if (submitBtn) {
          return {
            action: "click",
            selector: this.getBestSelector(submitBtn),
            description: "Submit form"
          };
        }
      }
      return null;
    }
    describeElement(el) {
      const tag = el.tagName.toLowerCase();
      const htmlEl = el;
      if (tag === "button" || tag === "a") {
        const text = htmlEl.innerText?.trim().slice(0, 30);
        if (text)
          return `Click "${text}"`;
      }
      if (tag === "input" || tag === "textarea" || tag === "select") {
        const inputEl = el;
        const labelFor = inputEl.id && document.querySelector(`label[for="${inputEl.id}"]`);
        if (labelFor) {
          return `Enter ${labelFor.innerText?.trim()}`;
        }
        if (inputEl.placeholder) {
          return `Enter ${inputEl.placeholder}`;
        }
        if (inputEl.name) {
          return `Enter ${inputEl.name.replace(/[_-]/g, " ")}`;
        }
        if (inputEl.type) {
          return `Enter ${inputEl.type}`;
        }
      }
      return `Interact with ${tag}`;
    }
    addTestAssertion() {
      if (!this.testRecording)
        return;
      const type = prompt(`What to check?

` + `1. Element exists (selector)
` + `2. Text content (selector, text)
` + `3. Input value (selector, value)
` + `4. URL contains (pattern)
` + `5. Element visible (selector)

` + "Enter number (1-5):");
      if (!type)
        return;
      let assertion = null;
      let description = "";
      switch (type.trim()) {
        case "1": {
          const selector = prompt("Enter CSS selector:");
          if (selector) {
            assertion = { type: "exists", selector };
            description = `Verify ${selector} exists`;
          }
          break;
        }
        case "2": {
          const selector = prompt("Enter CSS selector:");
          const text = prompt("Enter expected text (or part of it):");
          if (selector && text) {
            assertion = { type: "text", selector, text, contains: true };
            description = `Verify ${selector} contains "${text}"`;
          }
          break;
        }
        case "3": {
          const selector = prompt("Enter CSS selector for input:");
          const value = prompt("Enter expected value:");
          if (selector && value) {
            assertion = { type: "value", selector, value };
            description = `Verify ${selector} has value "${value}"`;
          }
          break;
        }
        case "4": {
          const pattern = prompt("Enter URL pattern to match:");
          if (pattern) {
            assertion = { type: "url", pattern };
            description = `Verify URL contains "${pattern}"`;
          }
          break;
        }
        case "5": {
          const selector = prompt("Enter CSS selector:");
          if (selector) {
            assertion = { type: "visible", selector };
            description = `Verify ${selector} is visible`;
          }
          break;
        }
      }
      if (assertion) {
        const step = {
          action: "assert",
          assertion,
          description
        };
        this.testRecording.steps.push(step);
        this.render();
        this.send("test-recording", "assertion", {
          index: this.testRecording.steps.length - 1,
          step
        });
      }
    }
    saveTest() {
      if (!this.testRecording || this.testRecording.steps.length === 0) {
        alert("No steps recorded!");
        return;
      }
      const name = prompt("Test name:", "Recorded test");
      if (!name)
        return;
      const description = prompt("Test description (optional):");
      const test = {
        version: 1,
        name,
        description: description || undefined,
        url: this.testRecording.startUrl,
        createdAt: this.testRecording.startTime,
        createdBy: "human",
        steps: this.testRecording.steps
      };
      const json = JSON.stringify(test, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.toLowerCase().replace(/\s+/g, "-")}.test.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.send("test-recording", "saved", { test });
      this.testRecording = null;
      this.render();
      alert(`Test saved: ${a.download}`);
    }
    startSemanticEvents() {
      if (this.semanticEventsEnabled)
        return;
      this.semanticEventsEnabled = true;
      this.semanticHandlers.click = (e) => {
        this.countRawEvent("click");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        const inputType = target.type;
        if (target.tagName === "INPUT" && (inputType === "checkbox" || inputType === "radio")) {
          return;
        }
        this.emitSemanticEvent({
          type: "interaction:click",
          timestamp: Date.now(),
          category: "interaction",
          target: this.getTargetInfo(target),
          payload: {
            text: target.innerText?.slice(0, 100),
            href: target.href,
            disabled: target.disabled,
            position: { x: e.clientX, y: e.clientY }
          }
        });
      };
      this.semanticHandlers.input = (e) => {
        this.countRawEvent("input");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        if (target.tagName === "INPUT") {
          const inputType = target.type;
          if (["checkbox", "radio", "range", "color", "date", "time", "datetime-local", "month", "week", "file"].includes(inputType)) {
            return;
          }
        }
        const isContentEditable = target.isContentEditable;
        const isFormField = "value" in target;
        if (!isContentEditable && !isFormField)
          return;
        const currentValue = isContentEditable ? target.innerText || "" : target.value;
        if (this.typingState.field === target) {
          if (this.typingState.timeout)
            clearTimeout(this.typingState.timeout);
        } else {
          this.flushTyping();
          this.typingState.field = target;
          this.typingState.startTime = Date.now();
          this.typingState.text = "";
        }
        this.typingState.text = currentValue;
        this.typingState.timeout = setTimeout(() => this.flushTyping(), this.TYPING_DEBOUNCE);
      };
      this.semanticHandlers.keydown = (e) => {
        this.countRawEvent("keydown");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        if (e.key === "Enter" && !e.isComposing) {
          const isContentEditable = target.isContentEditable;
          const isTextarea = target.tagName === "TEXTAREA";
          if (isContentEditable || isTextarea) {
            this.emitSemanticEvent({
              type: "input:newline",
              timestamp: Date.now(),
              category: "input",
              target: this.getTargetInfo(target),
              payload: {
                field: this.getBestSelector(target),
                shiftKey: e.shiftKey
              }
            });
          }
        }
        if (e.key === "Escape") {
          this.emitSemanticEvent({
            type: "input:escape",
            timestamp: Date.now(),
            category: "input",
            target: this.getTargetInfo(target),
            payload: {}
          });
        }
      };
      this.semanticHandlers.change = (e) => {
        this.countRawEvent("change");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        const tagName = target.tagName.toLowerCase();
        const inputType = target.type || "";
        if (tagName === "input" && ["text", "password", "email", "search", "tel", "url", "number"].includes(inputType)) {
          return;
        }
        if (tagName === "select") {
          const select = target;
          const selectedOptions = Array.from(select.selectedOptions).map((o) => o.value);
          const value = select.multiple ? selectedOptions.join(", ") : select.value;
          this.emitSemanticEvent({
            type: "input:changed",
            timestamp: Date.now(),
            category: "input",
            target: this.getTargetInfo(target),
            payload: {
              text: value,
              value,
              field: this.getBestSelector(target),
              fieldType: select.multiple ? "select-multiple" : "select-one",
              selectedOptions
            }
          });
          return;
        }
        if (tagName === "input") {
          const input = target;
          let value = input.value;
          let eventType = "input:changed";
          if (inputType === "checkbox" || inputType === "radio") {
            eventType = "input:checked";
            value = input.checked ? input.value || "on" : "";
          }
          if (inputType === "file" && input.files) {
            value = Array.from(input.files).map((f) => f.name).join(", ");
          }
          this.emitSemanticEvent({
            type: eventType,
            timestamp: Date.now(),
            category: "input",
            target: this.getTargetInfo(target),
            payload: {
              text: value,
              value,
              field: this.getBestSelector(target),
              fieldType: inputType,
              checked: input.checked
            }
          });
        }
      };
      this.semanticHandlers.scroll = () => {
        this.countRawEvent("scroll");
        const now = Date.now();
        if (this.scrollState.timeout) {
          clearTimeout(this.scrollState.timeout);
        } else {
          this.scrollState.startY = window.scrollY;
          this.scrollState.startTime = now;
        }
        this.scrollState.timeout = setTimeout(() => this.flushScroll(), this.SCROLL_DEBOUNCE);
      };
      this.semanticHandlers.mouseover = (e) => {
        this.countRawEvent("mouseover");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        if (this.hoverState.element === target)
          return;
        this.flushHover();
        this.hoverState.element = target;
        this.hoverState.enterTime = Date.now();
        this.emitSemanticEvent({
          type: "hover:enter",
          timestamp: Date.now(),
          category: "hover",
          target: this.getTargetInfo(target),
          payload: {
            from: e.relatedTarget ? this.getBestSelector(e.relatedTarget) : undefined
          }
        });
        this.hoverState.timeout = setTimeout(() => {
          if (this.hoverState.element === target) {
            const isInteractive = target.matches('a, button, input, select, textarea, [role="button"], [tabindex]');
            this.emitSemanticEvent({
              type: "hover:dwell",
              timestamp: Date.now(),
              category: "hover",
              target: this.getTargetInfo(target),
              payload: {
                duration: Date.now() - this.hoverState.enterTime,
                element: this.getBestSelector(target),
                interactive: isInteractive
              }
            });
          }
        }, this.DWELL_THRESHOLD);
      };
      this.semanticHandlers.mouseout = (e) => {
        const target = e.target;
        if (!target || this.hoverState.element !== target)
          return;
        this.flushHover();
      };
      this.semanticHandlers.focus = (e) => {
        this.countRawEvent("focus");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        this.emitSemanticEvent({
          type: "focus:in",
          timestamp: Date.now(),
          category: "focus",
          target: this.getTargetInfo(target),
          payload: {
            fieldType: target.type,
            hasValue: !!target.value,
            required: target.required
          }
        });
      };
      this.semanticHandlers.blur = (e) => {
        this.countRawEvent("blur");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        this.emitSemanticEvent({
          type: "focus:out",
          timestamp: Date.now(),
          category: "focus",
          target: this.getTargetInfo(target),
          payload: {
            fieldType: target.type,
            hasValue: !!target.value,
            required: target.required
          }
        });
      };
      this.semanticHandlers.submit = (e) => {
        this.countRawEvent("submit");
        const form = e.target;
        if (!form || this.contains(form))
          return;
        this.emitSemanticEvent({
          type: "form:submit",
          timestamp: Date.now(),
          category: "interaction",
          target: this.getTargetInfo(form),
          payload: {
            formId: form.id,
            formName: form.name,
            formAction: form.action,
            fieldCount: form.elements.length,
            method: form.method
          }
        });
      };
      this.semanticHandlers.reset = (e) => {
        this.countRawEvent("reset");
        const form = e.target;
        if (!form || this.contains(form))
          return;
        this.emitSemanticEvent({
          type: "form:reset",
          timestamp: Date.now(),
          category: "interaction",
          target: this.getTargetInfo(form),
          payload: {
            formId: form.id,
            formName: form.name
          }
        });
      };
      this.semanticHandlers.invalid = (e) => {
        this.countRawEvent("invalid");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        this.emitSemanticEvent({
          type: "form:invalid",
          timestamp: Date.now(),
          category: "input",
          target: this.getTargetInfo(target),
          payload: {
            field: this.getBestSelector(target),
            fieldName: target.name,
            fieldType: target.type,
            validationMessage: target.validationMessage,
            validity: {
              valueMissing: target.validity.valueMissing,
              typeMismatch: target.validity.typeMismatch,
              patternMismatch: target.validity.patternMismatch,
              tooShort: target.validity.tooShort,
              tooLong: target.validity.tooLong,
              rangeUnderflow: target.validity.rangeUnderflow,
              rangeOverflow: target.validity.rangeOverflow,
              stepMismatch: target.validity.stepMismatch
            }
          }
        });
      };
      this.semanticHandlers.popstate = () => {
        this.countRawEvent("popstate");
        this.emitSemanticEvent({
          type: "navigation:navigate",
          timestamp: Date.now(),
          category: "navigation",
          payload: {
            from: document.referrer,
            to: location.href,
            trigger: "popstate"
          }
        });
      };
      let dragState = null;
      this.semanticHandlers.mousedown = (e) => {
        this.countRawEvent("mousedown");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        dragState = {
          target,
          startX: e.clientX,
          startY: e.clientY,
          startTime: Date.now()
        };
      };
      this.semanticHandlers.mouseup = (e) => {
        this.countRawEvent("mouseup");
        if (!dragState)
          return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const duration = Date.now() - dragState.startTime;
        const isSignificantMove = distance > 10;
        const isDeliberateHold = duration > 200;
        if (isSignificantMove || isDeliberateHold) {
          this.emitSemanticEvent({
            type: "interaction:drag",
            timestamp: Date.now(),
            category: "interaction",
            target: this.getTargetInfo(dragState.target),
            payload: {
              startX: dragState.startX,
              startY: dragState.startY,
              endX: e.clientX,
              endY: e.clientY,
              distance: Math.round(distance),
              duration,
              direction: Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up"
            }
          });
        }
        dragState = null;
      };
      this.semanticHandlers.cut = (e) => {
        this.countRawEvent("cut");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        const selection = document.getSelection();
        const text = selection?.toString() || "";
        this.emitSemanticEvent({
          type: "interaction:cut",
          timestamp: Date.now(),
          category: "interaction",
          target: this.getTargetInfo(target),
          payload: {
            text: text.slice(0, 200),
            length: text.length
          }
        });
      };
      this.semanticHandlers.copy = (e) => {
        this.countRawEvent("copy");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        const selection = document.getSelection();
        const text = selection?.toString() || "";
        this.emitSemanticEvent({
          type: "interaction:copy",
          timestamp: Date.now(),
          category: "interaction",
          target: this.getTargetInfo(target),
          payload: {
            text: text.slice(0, 200),
            length: text.length
          }
        });
      };
      this.semanticHandlers.paste = (e) => {
        this.countRawEvent("paste");
        const target = e.target;
        if (!target || this.contains(target))
          return;
        const text = e.clipboardData?.getData("text") || "";
        this.emitSemanticEvent({
          type: "interaction:paste",
          timestamp: Date.now(),
          category: "interaction",
          target: this.getTargetInfo(target),
          payload: {
            text: text.slice(0, 200),
            length: text.length
          }
        });
      };
      let selectionTimeout = null;
      this.semanticHandlers.selectionchange = () => {
        this.countRawEvent("selectionchange");
        if (selectionTimeout)
          clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
          const selection = document.getSelection();
          if (!selection || selection.isCollapsed)
            return;
          const text = selection.toString().trim();
          if (!text || text.length < 2)
            return;
          const anchorNode = selection.anchorNode;
          const element = anchorNode?.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
          if (!element || this.contains(element))
            return;
          this.emitSemanticEvent({
            type: "interaction:select",
            timestamp: Date.now(),
            category: "interaction",
            target: this.getTargetInfo(element),
            payload: {
              text: text.slice(0, 200),
              length: text.length,
              selector: this.getBestSelector(element)
            }
          });
        }, 300);
      };
      document.addEventListener("click", this.semanticHandlers.click, true);
      document.addEventListener("input", this.semanticHandlers.input, true);
      document.addEventListener("change", this.semanticHandlers.change, true);
      document.addEventListener("keydown", this.semanticHandlers.keydown, true);
      document.addEventListener("cut", this.semanticHandlers.cut, true);
      document.addEventListener("copy", this.semanticHandlers.copy, true);
      document.addEventListener("paste", this.semanticHandlers.paste, true);
      document.addEventListener("selectionchange", this.semanticHandlers.selectionchange);
      window.addEventListener("scroll", this.semanticHandlers.scroll, { passive: true });
      document.addEventListener("mouseover", this.semanticHandlers.mouseover, true);
      document.addEventListener("mouseout", this.semanticHandlers.mouseout, true);
      document.addEventListener("focusin", this.semanticHandlers.focus, true);
      document.addEventListener("focusout", this.semanticHandlers.blur, true);
      document.addEventListener("submit", this.semanticHandlers.submit, true);
      document.addEventListener("reset", this.semanticHandlers.reset, true);
      document.addEventListener("invalid", this.semanticHandlers.invalid, true);
      window.addEventListener("popstate", this.semanticHandlers.popstate);
      document.addEventListener("mousedown", this.semanticHandlers.mousedown, true);
      document.addEventListener("mouseup", this.semanticHandlers.mouseup, true);
      this.emitSemanticEvent({
        type: "navigation:navigate",
        timestamp: Date.now(),
        category: "navigation",
        payload: {
          from: document.referrer,
          to: location.href,
          trigger: "initial"
        }
      });
    }
    stopSemanticEvents() {
      if (!this.semanticEventsEnabled)
        return;
      this.semanticEventsEnabled = false;
      this.flushTyping();
      this.flushScroll();
      this.flushHover();
      if (this.semanticHandlers.click) {
        document.removeEventListener("click", this.semanticHandlers.click, true);
      }
      if (this.semanticHandlers.input) {
        document.removeEventListener("input", this.semanticHandlers.input, true);
      }
      if (this.semanticHandlers.change) {
        document.removeEventListener("change", this.semanticHandlers.change, true);
      }
      if (this.semanticHandlers.keydown) {
        document.removeEventListener("keydown", this.semanticHandlers.keydown, true);
      }
      if (this.semanticHandlers.cut) {
        document.removeEventListener("cut", this.semanticHandlers.cut, true);
      }
      if (this.semanticHandlers.copy) {
        document.removeEventListener("copy", this.semanticHandlers.copy, true);
      }
      if (this.semanticHandlers.paste) {
        document.removeEventListener("paste", this.semanticHandlers.paste, true);
      }
      if (this.semanticHandlers.selectionchange) {
        document.removeEventListener("selectionchange", this.semanticHandlers.selectionchange);
      }
      if (this.semanticHandlers.scroll) {
        window.removeEventListener("scroll", this.semanticHandlers.scroll);
      }
      if (this.semanticHandlers.mouseover) {
        document.removeEventListener("mouseover", this.semanticHandlers.mouseover, true);
      }
      if (this.semanticHandlers.mouseout) {
        document.removeEventListener("mouseout", this.semanticHandlers.mouseout, true);
      }
      if (this.semanticHandlers.focus) {
        document.removeEventListener("focusin", this.semanticHandlers.focus, true);
      }
      if (this.semanticHandlers.blur) {
        document.removeEventListener("focusout", this.semanticHandlers.blur, true);
      }
      if (this.semanticHandlers.submit) {
        document.removeEventListener("submit", this.semanticHandlers.submit, true);
      }
      if (this.semanticHandlers.reset) {
        document.removeEventListener("reset", this.semanticHandlers.reset, true);
      }
      if (this.semanticHandlers.invalid) {
        document.removeEventListener("invalid", this.semanticHandlers.invalid, true);
      }
      if (this.semanticHandlers.popstate) {
        window.removeEventListener("popstate", this.semanticHandlers.popstate);
      }
      if (this.semanticHandlers.mousedown) {
        document.removeEventListener("mousedown", this.semanticHandlers.mousedown, true);
      }
      if (this.semanticHandlers.mouseup) {
        document.removeEventListener("mouseup", this.semanticHandlers.mouseup, true);
      }
      this.semanticHandlers = {};
    }
    flushTyping() {
      if (this.typingState.field) {
        const field = this.typingState.field;
        const isContentEditable = field.isContentEditable;
        if (field.tagName === "INPUT") {
          const inputType = field.type;
          if (["checkbox", "radio", "range", "color", "date", "time", "datetime-local", "month", "week", "file"].includes(inputType)) {
            if (this.typingState.timeout)
              clearTimeout(this.typingState.timeout);
            this.typingState = { field: null, startTime: 0, text: "", timeout: null };
            return;
          }
        }
        const finalValue = isContentEditable ? field.innerText || "" : field.value;
        const fieldType = isContentEditable ? "contenteditable" : field.type || field.tagName.toLowerCase();
        if (this.typingState.text || finalValue === "") {
          this.emitSemanticEvent({
            type: finalValue === "" ? "input:cleared" : "input:typed",
            timestamp: Date.now(),
            category: "input",
            target: this.getTargetInfo(field),
            payload: {
              text: finalValue,
              field: this.getBestSelector(field),
              fieldType,
              duration: Date.now() - this.typingState.startTime,
              finalValue
            }
          });
        }
      }
      if (this.typingState.timeout)
        clearTimeout(this.typingState.timeout);
      this.typingState = { field: null, startTime: 0, text: "", timeout: null };
    }
    flushScroll() {
      if (this.scrollState.timeout) {
        const distance = Math.abs(window.scrollY - this.scrollState.startY);
        if (distance > 50) {
          const viewportMid = window.innerHeight / 2;
          const elemAtMid = document.elementFromPoint(window.innerWidth / 2, viewportMid);
          let toSelector = "unknown";
          if (window.scrollY < 100) {
            toSelector = "top";
          } else if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 100) {
            toSelector = "bottom";
          } else if (elemAtMid) {
            toSelector = this.getBestSelector(elemAtMid);
          }
          this.emitSemanticEvent({
            type: "scroll:stop",
            timestamp: Date.now(),
            category: "scroll",
            payload: {
              to: toSelector,
              direction: window.scrollY > this.scrollState.startY ? "down" : "up",
              distance,
              duration: Date.now() - this.scrollState.startTime
            }
          });
        }
        clearTimeout(this.scrollState.timeout);
      }
      this.scrollState = { startY: 0, startTime: 0, timeout: null };
    }
    flushHover() {
      if (this.hoverState.element) {
        const dwellTime = Date.now() - this.hoverState.enterTime;
        this.emitSemanticEvent({
          type: "hover:leave",
          timestamp: Date.now(),
          category: "hover",
          target: this.getTargetInfo(this.hoverState.element),
          payload: {
            to: undefined,
            dwellTime
          }
        });
      }
      if (this.hoverState.timeout)
        clearTimeout(this.hoverState.timeout);
      this.hoverState = { element: null, enterTime: 0, timeout: null };
    }
    getTargetInfo(el) {
      return {
        selector: this.getBestSelector(el),
        tag: el.tagName.toLowerCase(),
        id: el.id || undefined,
        text: el.innerText?.slice(0, 50),
        role: el.getAttribute("role") || undefined,
        label: el.getAttribute("aria-label") || el.labels?.[0]?.innerText
      };
    }
    countRawEvent(eventType) {
      this.rawEventCounts[eventType] = (this.rawEventCounts[eventType] || 0) + 1;
    }
    emitSemanticEvent(event) {
      this.semanticEventCounts[event.category]++;
      if (this.semanticSubscription) {
        const categories = this.semanticSubscription.categories || (this.semanticSubscription.preset ? this.SEMANTIC_PRESETS[this.semanticSubscription.preset] : null);
        if (categories && !categories.includes(event.category)) {
          return;
        }
      }
      this.semanticEventBuffer.push(event);
      if (this.semanticEventBuffer.length > this.SEMANTIC_BUFFER_MAX) {
        this.semanticEventBuffer.shift();
      }
      if (this.logPanelOpen) {
        this.updateLogPanel();
      }
      this.send("semantic", event.type, event);
    }
    getSemanticBuffer(since) {
      if (since) {
        return this.semanticEventBuffer.filter((e) => e.timestamp > since);
      }
      return [...this.semanticEventBuffer];
    }
    connect() {
      if (this.ws)
        return;
      if (this.killed)
        return;
      this.state = "connecting";
      this.render();
      try {
        this.ws = new WebSocket(this.serverUrl);
        this.ws.onopen = () => {
          this.state = "connected";
          this.show();
          const windowType = window.opener ? "popup" : window.parent !== window ? "iframe" : "tab";
          this.send("system", "connected", {
            windowId: this.windowId,
            browserId: this.browserId,
            version: VERSION2,
            serverSessionId: SERVER_SESSION_ID,
            url: location.href,
            title: document.title,
            active: this.isActive,
            windowType
          });
          this.setupNavigationWatcher();
        };
        this.ws.onmessage = (e) => {
          if (this.state === "paused")
            return;
          try {
            const msg2 = JSON.parse(e.data);
            this.handleMessage(msg2);
          } catch {}
        };
        this.ws.onclose = () => {
          this.ws = null;
          this.state = "disconnected";
          this.render();
          if (!this.killed) {
            setTimeout(() => this.connect(), 3000);
          }
        };
        this.ws.onerror = () => {
          this.ws?.close();
        };
      } catch (err) {
        this.state = "disconnected";
        this.render();
      }
    }
    disconnect() {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.state = "disconnected";
      this.pending.forEach((p) => p.reject(new Error("Disconnected")));
      this.pending.clear();
      this.cleanupNavigationWatcher();
    }
    lastReportedUrl = "";
    lastReportedTitle = "";
    navigationWatcherInterval = null;
    setupNavigationWatcher() {
      this.lastReportedUrl = location.href;
      this.lastReportedTitle = document.title;
      this.navigationWatcherInterval = setInterval(() => {
        const currentUrl = location.href;
        const currentTitle = document.title;
        if (currentUrl !== this.lastReportedUrl || currentTitle !== this.lastReportedTitle) {
          this.lastReportedUrl = currentUrl;
          this.lastReportedTitle = currentTitle;
          this.send("system", "window-updated", {
            windowId: this.windowId,
            url: currentUrl,
            title: currentTitle
          });
        }
      }, 500);
    }
    cleanupNavigationWatcher() {
      if (this.navigationWatcherInterval) {
        clearInterval(this.navigationWatcherInterval);
        this.navigationWatcherInterval = null;
      }
    }
    activate() {
      this.isActive = true;
      this.send("system", "window-state", {
        windowId: this.windowId,
        active: true
      });
      this.render();
    }
    deactivate() {
      this.isActive = false;
      this.send("system", "window-state", {
        windowId: this.windowId,
        active: false
      });
      this.render();
    }
    send(channel, action2, payload2, id) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
        return;
      const msg2 = {
        id: id || uid(),
        channel,
        action: action2,
        payload: payload2,
        timestamp: Date.now(),
        source: "browser"
      };
      this.ws.send(JSON.stringify(msg2));
    }
    respond(requestId, success, data, error) {
      const response = {
        id: requestId,
        success,
        data,
        error,
        timestamp: Date.now()
      };
      this.ws?.send(JSON.stringify(response));
    }
    handleMessage(msg2) {
      if (msg2.source === "agent" || msg2.source === "server") {
        this.show();
      }
      const targetWindowId = msg2.payload?.windowId;
      const isTargeted = !!targetWindowId;
      const isForUs = !targetWindowId || targetWindowId === this.windowId;
      if (isTargeted && !isForUs) {
        return;
      }
      if (!this.isActive && !isForUs && msg2.channel !== "system") {
        return;
      }
      switch (msg2.channel) {
        case "system":
          this.handleSystemMessage(msg2);
          break;
        case "dom":
          this.handleDomMessage(msg2);
          break;
        case "events":
          this.handleEventsMessage(msg2);
          break;
        case "console":
          this.handleConsoleMessage(msg2);
          break;
        case "eval":
          this.handleEvalMessage(msg2);
          break;
        case "recording":
          this.handleRecordingMessage(msg2);
          break;
        case "selection":
          this.handleSelectionMessage(msg2);
          break;
        case "navigation":
          this.handleNavigationMessage(msg2);
          break;
        case "tabs":
          this.handleTabsMessage(msg2);
          break;
        case "mutations":
          this.handleMutationsMessage(msg2);
          break;
        case "semantic":
          this.handleSemanticMessage(msg2);
          break;
      }
      this.render();
    }
    handleSemanticMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      if (action2 === "start" || action2 === "watch") {
        this.semanticSubscription = payload2 || null;
        this.rawEventCounts = {};
        this.semanticEventCounts = {
          interaction: 0,
          navigation: 0,
          input: 0,
          hover: 0,
          scroll: 0,
          mutation: 0,
          console: 0,
          focus: 0
        };
        this.statsStartTime = Date.now();
        this.startSemanticEvents();
        const categories = this.semanticSubscription?.categories || (this.semanticSubscription?.preset ? this.SEMANTIC_PRESETS[this.semanticSubscription.preset] : Object.values(this.SEMANTIC_PRESETS).flat());
        this.respond(msg2.id, true, {
          watching: true,
          preset: this.semanticSubscription?.preset,
          categories: [...new Set(categories)]
        });
      } else if (action2 === "stop" || action2 === "unwatch") {
        this.stopSemanticEvents();
        this.semanticSubscription = null;
        this.respond(msg2.id, true, { watching: false });
      } else if (action2 === "buffer" || action2 === "get") {
        const since = payload2?.since;
        const category = payload2?.category;
        let events = this.getSemanticBuffer(since);
        if (category) {
          events = events.filter((e) => e.category === category);
        }
        this.respond(msg2.id, true, {
          events,
          enabled: this.semanticEventsEnabled
        });
      } else if (action2 === "status") {
        this.respond(msg2.id, true, {
          enabled: this.semanticEventsEnabled,
          bufferSize: this.semanticEventBuffer.length,
          subscription: this.semanticSubscription
        });
      } else if (action2 === "stats") {
        const totalRaw = Object.values(this.rawEventCounts).reduce((a, b) => a + b, 0);
        const totalSemantic = Object.values(this.semanticEventCounts).reduce((a, b) => a + b, 0);
        const duration = Date.now() - this.statsStartTime;
        const byPreset = {};
        for (const [preset, categories] of Object.entries(this.SEMANTIC_PRESETS)) {
          const count = categories.reduce((sum, cat) => sum + (this.semanticEventCounts[cat] || 0), 0);
          byPreset[preset] = { events: count, categories };
        }
        this.respond(msg2.id, true, {
          duration,
          raw: {
            total: totalRaw,
            byType: this.rawEventCounts
          },
          semantic: {
            total: totalSemantic,
            byCategory: this.semanticEventCounts
          },
          byPreset,
          noiseReduction: totalRaw > 0 ? Math.round((1 - totalSemantic / totalRaw) * 100) : 0
        });
      }
    }
    handleSystemMessage(msg) {
      const { action, payload } = msg;
      if (action === "connected" && payload?.browserId && payload.browserId !== this.browserId) {
        if (payload.windowId === this.windowId) {
          this.kill();
        }
      }
      if (action === "version") {
        this.respond(msg.id, true, {
          version: VERSION2,
          windowId: this.windowId,
          browserId: this.browserId,
          url: location.href,
          title: document.title,
          state: this.state,
          active: this.isActive
        });
      }
      if (action === "activate") {
        if (!payload?.windowId || payload.windowId === this.windowId) {
          this.isActive = true;
          this.render();
          this.respond(msg.id, true, { windowId: this.windowId, active: true });
        }
      }
      if (action === "deactivate") {
        if (!payload?.windowId || payload.windowId === this.windowId) {
          this.isActive = false;
          this.render();
          this.respond(msg.id, true, { windowId: this.windowId, active: false });
        }
      }
      if (action === "focus") {
        if (!payload?.windowId || payload.windowId === this.windowId) {
          window.focus();
          this.isActive = true;
          this.render();
          this.respond(msg.id, true, { windowId: this.windowId, focused: true });
        }
      }
      if (action === "window-info") {
        this.respond(msg.id, true, {
          windowId: this.windowId,
          browserId: this.browserId,
          url: location.href,
          title: document.title,
          active: this.isActive
        });
      }
      if (action === "reload") {
        this.respond(msg.id, true, { reloading: true, oldVersion: VERSION2 });
        this.ws?.close();
        const serverUrl = this.serverUrl.replace("/ws/browser", "").replace("ws://", "http://").replace("wss://", "https://");
        fetch(`${serverUrl}/component.js?t=${Date.now()}`).then((r) => r.text()).then((code) => {
          const wsUrl = this.serverUrl;
          this.remove();
          eval(code);
          const NewDevChannel = window.DevChannel;
          const creator = NewDevChannel.elementCreator();
          const newWidget = creator();
          newWidget.setAttribute("server", wsUrl);
          newWidget.setAttribute("data-version", NewDevChannel.VERSION || VERSION2);
          document.body.appendChild(newWidget);
        }).catch((err) => {
          console.error(`${LOG_PREFIX} Failed to reload:`, err);
        });
      }
    }
    handleNavigationMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      if (action2 === "refresh") {
        if (payload2.hard) {
          location.reload();
        } else {
          location.reload();
        }
        this.respond(msg2.id, true);
      } else if (action2 === "goto") {
        location.href = payload2.url;
        this.respond(msg2.id, true);
      } else if (action2 === "location") {
        this.respond(msg2.id, true, {
          url: location.href,
          title: document.title,
          pathname: location.pathname,
          search: location.search,
          hash: location.hash
        });
      }
    }
    handleTabsMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      const haltija = window.haltija;
      if (action2 === "open") {
        if (haltija?.openTab) {
          haltija.openTab(payload2.url).then((opened) => {
            this.respond(msg2.id, true, { opened });
          }).catch((err) => {
            this.respond(msg2.id, false, null, err.message);
          });
        } else {
          window.open(payload2.url, "_blank");
          this.respond(msg2.id, true, { opened: true, fallback: true });
        }
      } else if (action2 === "close") {
        if (haltija?.closeTab) {
          haltija.closeTab(payload2.windowId);
          this.respond(msg2.id, true);
        } else {
          this.respond(msg2.id, false, null, "Tab close not available outside Electron app");
        }
      } else if (action2 === "focus") {
        if (haltija?.focusTab) {
          haltija.focusTab(payload2.windowId);
          this.respond(msg2.id, true);
        } else {
          this.respond(msg2.id, false, null, "Tab focus not available outside Electron app");
        }
      } else {
        this.respond(msg2.id, false, null, `Unknown tabs action: ${action2}`);
      }
    }
    handleDomMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      if (action2 === "query") {
        const req = payload2;
        try {
          if (req.all) {
            const elements = document.querySelectorAll(req.selector);
            this.respond(msg2.id, true, Array.from(elements).map(extractElement));
          } else {
            const el = document.querySelector(req.selector);
            this.respond(msg2.id, true, el ? extractElement(el) : null);
          }
        } catch (err) {
          this.respond(msg2.id, false, null, err.message);
        }
      } else if (action2 === "inspect") {
        try {
          const el = document.querySelector(payload2.selector);
          if (!el) {
            this.respond(msg2.id, false, null, `Element not found: ${payload2.selector}`);
            return;
          }
          this.respond(msg2.id, true, inspectElement(el));
        } catch (err) {
          this.respond(msg2.id, false, null, err.message);
        }
      } else if (action2 === "inspectAll") {
        try {
          const elements = document.querySelectorAll(payload2.selector);
          const results = Array.from(elements).slice(0, payload2.limit || 10).map((el) => inspectElement(el));
          this.respond(msg2.id, true, results);
        } catch (err) {
          this.respond(msg2.id, false, null, err.message);
        }
      } else if (action2 === "highlight") {
        try {
          const el = document.querySelector(payload2.selector);
          if (!el) {
            this.respond(msg2.id, false, null, `Element not found: ${payload2.selector}`);
            return;
          }
          if (payload2.duration) {
            pulseHighlight(el, payload2.label, payload2.color, payload2.duration);
          } else {
            showHighlight(el, payload2.label, payload2.color);
          }
          this.respond(msg2.id, true, { highlighted: payload2.selector });
        } catch (err) {
          this.respond(msg2.id, false, null, err.message);
        }
      } else if (action2 === "unhighlight") {
        hideHighlight();
        this.respond(msg2.id, true);
      } else if (action2 === "tree") {
        try {
          const request = payload2;
          const el = document.querySelector(request.selector);
          if (!el) {
            this.respond(msg2.id, false, null, `Element not found: ${request.selector}`);
            return;
          }
          const tree = buildDomTree(el, request);
          this.respond(msg2.id, true, tree);
        } catch (err) {
          this.respond(msg2.id, false, null, err.message);
        }
      } else if (action2 === "screenshot") {
        try {
          const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            devicePixelRatio: window.devicePixelRatio,
            url: location.href,
            title: document.title
          };
          this.respond(msg2.id, true, { viewport, note: "Use browser devtools or Playwright for actual screenshot capture" });
        } catch (err) {
          this.respond(msg2.id, false, null, err.message);
        }
      }
    }
    handleEventsMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      if (action2 === "watch") {
        const req = payload2;
        this.watchEvents(req, msg2.id);
      } else if (action2 === "unwatch") {
        const unwatcher = this.eventWatchers.get(payload2.watchId);
        if (unwatcher) {
          unwatcher();
          this.eventWatchers.delete(payload2.watchId);
        }
        this.respond(msg2.id, true);
      } else if (action2 === "dispatch") {
        this.dispatchSyntheticEvent(payload2, msg2.id);
      }
    }
    handleConsoleMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      if (action2 === "get") {
        const since = payload2?.since || 0;
        const entries = this.consoleBuffer.filter((e) => e.timestamp > since);
        this.respond(msg2.id, true, entries);
      } else if (action2 === "clear") {
        this.consoleBuffer = [];
        this.respond(msg2.id, true);
      }
    }
    handleEvalMessage(msg) {
      try {
        const result = eval(msg.payload.code);
        this.respond(msg.id, true, result);
      } catch (err) {
        this.respond(msg.id, false, null, err.message);
      }
    }
    handleRecordingMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      if (action2 === "start") {
        this.recording = {
          id: uid(),
          name: payload2.name || "Recording",
          startTime: Date.now(),
          events: [],
          consoleEntries: []
        };
        this.watchEvents({
          events: ["click", "input", "change", "keydown", "submit", "focus", "blur"]
        }, `recording-${this.recording.id}`);
        this.respond(msg2.id, true, { sessionId: this.recording.id });
      } else if (action2 === "stop") {
        if (this.recording) {
          this.recording.endTime = Date.now();
          this.recording.consoleEntries = [...this.consoleBuffer];
          const session = this.recording;
          this.eventWatchers.get(`recording-${session.id}`)?.();
          this.eventWatchers.delete(`recording-${session.id}`);
          this.recording = null;
          this.respond(msg2.id, true, session);
        } else {
          this.respond(msg2.id, false, null, "No active recording");
        }
      } else if (action2 === "replay") {
        this.replaySession(payload2.session, payload2.speed || 1, msg2.id);
      }
    }
    handleSelectionMessage(msg2) {
      const { action: action2 } = msg2;
      if (action2 === "start") {
        this.startSelection();
        this.respond(msg2.id, true, { active: true });
      } else if (action2 === "cancel") {
        this.cancelSelection();
        this.respond(msg2.id, true, { active: false });
      } else if (action2 === "status") {
        this.respond(msg2.id, true, {
          active: this.selectionActive,
          hasResult: this.selectionResult !== null
        });
      } else if (action2 === "result") {
        if (this.selectionResult) {
          this.respond(msg2.id, true, this.selectionResult);
        } else {
          this.respond(msg2.id, false, null, "No selection available");
        }
      } else if (action2 === "clear") {
        this.clearSelection();
        this.respond(msg2.id, true, { cleared: true });
      } else {
        this.respond(msg2.id, false, null, `Unknown selection action: ${action2}`);
      }
    }
    handleMutationsMessage(msg2) {
      const { action: action2, payload: payload2 } = msg2;
      try {
        if (action2 === "watch") {
          this.startMutationWatch(payload2);
          this.respond(msg2.id, true, { watching: true });
        } else if (action2 === "unwatch") {
          this.stopMutationWatch();
          this.respond(msg2.id, true, { watching: false });
        } else if (action2 === "status") {
          this.respond(msg2.id, true, {
            watching: this.mutationObserver !== null,
            config: this.mutationConfig
          });
        }
      } catch (err) {
        this.respond(msg2.id, false, null, err.message);
      }
    }
    startMutationWatch(config) {
      this.stopMutationWatch();
      this.mutationConfig = config;
      const root = config.root ? document.querySelector(config.root) : document.body;
      if (!root) {
        this.send("mutations", "error", { error: `Root element not found: ${config.root}` });
        return;
      }
      const preset = config.preset ?? "smart";
      let presetRules;
      if (preset === "smart") {
        const detected = detectFramework();
        const detectedRules = detected.map((p) => FILTER_PRESETS[p]);
        presetRules = mergeFilterRules(FILTER_PRESETS.smart, ...detectedRules);
        this.send("mutations", "detected", { frameworks: detected });
      } else {
        presetRules = FILTER_PRESETS[preset];
      }
      this.mutationFilterRules = mergeFilterRules(presetRules, config.filters);
      const debounceMs = config.debounce ?? 100;
      this.mutationObserver = new MutationObserver((mutations) => {
        this.pendingMutations.push(...mutations);
        if (this.mutationDebounceTimer) {
          clearTimeout(this.mutationDebounceTimer);
        }
        this.mutationDebounceTimer = setTimeout(() => {
          this.flushMutations();
        }, debounceMs);
      });
      const observerOptions = {
        childList: config.childList ?? true,
        attributes: config.attributes ?? true,
        characterData: config.characterData ?? false,
        subtree: config.subtree ?? true,
        attributeOldValue: config.attributes ?? true,
        characterDataOldValue: config.characterData ?? false
      };
      this.mutationObserver.observe(root, observerOptions);
      if (config.pierceShadow) {
        this.attachShadowObservers(root, observerOptions, debounceMs);
      }
      this.send("mutations", "started", { config, shadowRoots: this.shadowObservers.size });
    }
    attachShadowObservers(root, options, debounceMs) {
      const attachToShadowRoot = (shadowRoot) => {
        if (this.shadowObservers.has(shadowRoot))
          return;
        const observer = new MutationObserver((mutations) => {
          this.pendingMutations.push(...mutations);
          if (this.mutationDebounceTimer) {
            clearTimeout(this.mutationDebounceTimer);
          }
          this.mutationDebounceTimer = setTimeout(() => {
            this.flushMutations();
          }, debounceMs);
        });
        observer.observe(shadowRoot, options);
        this.shadowObservers.set(shadowRoot, observer);
        for (const el of shadowRoot.querySelectorAll("*")) {
          if (el.shadowRoot) {
            attachToShadowRoot(el.shadowRoot);
          }
        }
      };
      for (const el of root.querySelectorAll("*")) {
        if (el.shadowRoot) {
          attachToShadowRoot(el.shadowRoot);
        }
      }
      if (root.shadowRoot) {
        attachToShadowRoot(root.shadowRoot);
      }
    }
    checkNewElementsForShadowRoots(mutations) {
      if (!this.mutationConfig?.pierceShadow)
        return;
      const debounceMs = this.mutationConfig.debounce ?? 100;
      const options = {
        childList: this.mutationConfig.childList ?? true,
        attributes: this.mutationConfig.attributes ?? true,
        characterData: this.mutationConfig.characterData ?? false,
        subtree: this.mutationConfig.subtree ?? true,
        attributeOldValue: this.mutationConfig.attributes ?? true,
        characterDataOldValue: this.mutationConfig.characterData ?? false
      };
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            if (el.shadowRoot) {
              this.attachShadowObservers(el, options, debounceMs);
            }
            for (const child of el.querySelectorAll("*")) {
              if (child.shadowRoot) {
                this.attachShadowObservers(child, options, debounceMs);
              }
            }
          }
        }
      }
    }
    stopMutationWatch() {
      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }
      for (const observer of this.shadowObservers.values()) {
        observer.disconnect();
      }
      this.shadowObservers.clear();
      if (this.mutationDebounceTimer) {
        clearTimeout(this.mutationDebounceTimer);
        this.mutationDebounceTimer = null;
      }
      this.pendingMutations = [];
      this.mutationConfig = null;
      this.mutationFilterRules = null;
    }
    flushMutations() {
      if (this.pendingMutations.length === 0)
        return;
      const mutations = this.pendingMutations;
      this.pendingMutations = [];
      this.checkNewElementsForShadowRoots(mutations);
      const rules = this.mutationFilterRules || {};
      let added = 0;
      let removed = 0;
      let attributeChanges = 0;
      let textChanges = 0;
      let ignored = 0;
      const notable = [];
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;
              if (shouldIgnoreElement(el, rules)) {
                ignored++;
                continue;
              }
              if (!matchesOnlyFilter(el, rules)) {
                ignored++;
                continue;
              }
              added++;
              const hasId = !!el.id;
              const isSignificant = ["DIALOG", "MODAL", "FORM", "BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
              const isCustomElement = el.tagName.includes("-");
              const classes = el.className?.toString().split(/\s+/).filter(Boolean) || [];
              const { interesting: interestingClasses } = filterClasses(classes, rules);
              const hasInterestingClasses = interestingClasses.length > 0;
              const hasInterestingAttrs = Array.from(el.attributes).some((attr) => isInterestingAttribute(attr.name, rules));
              if (hasId || isSignificant || isCustomElement || hasInterestingClasses || hasInterestingAttrs) {
                const mutation = {
                  type: "added",
                  selector: getSelector(el),
                  tagName: el.tagName.toLowerCase(),
                  id: el.id || undefined,
                  className: interestingClasses.length > 0 ? interestingClasses.join(" ") : classes.slice(0, 3).join(" ") || undefined
                };
                notable.push(mutation);
              }
            }
          }
          for (const node of m.removedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node;
              if (shouldIgnoreElement(el, rules)) {
                ignored++;
                continue;
              }
              removed++;
              const hasId = !!el.id;
              const isSignificant = ["DIALOG", "MODAL", "FORM", "BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
              const isCustomElement = el.tagName.includes("-");
              if (hasId || isSignificant || isCustomElement) {
                notable.push({
                  type: "removed",
                  selector: getSelector(el),
                  tagName: el.tagName.toLowerCase(),
                  id: el.id || undefined,
                  className: el.className?.toString().split(/\s+/).slice(0, 3).join(" ") || undefined
                });
              }
            }
          }
        } else if (m.type === "attributes") {
          const el = m.target;
          const attrName = m.attributeName || "";
          if (shouldIgnoreElement(el, rules)) {
            ignored++;
            continue;
          }
          if (rules.ignoreAttributes?.some((pattern) => attrName.startsWith(pattern) || attrName === pattern)) {
            ignored++;
            continue;
          }
          if (attrName === "class") {
            const oldClasses = (m.oldValue || "").split(/\s+/).filter(Boolean);
            const newClasses = (el.className?.toString() || "").split(/\s+/).filter(Boolean);
            const addedClasses = newClasses.filter((c) => !oldClasses.includes(c));
            const removedClasses = oldClasses.filter((c) => !newClasses.includes(c));
            const { interesting: addedInteresting, ignored: addedIgnored } = filterClasses(addedClasses, rules);
            const { interesting: removedInteresting, ignored: removedIgnored } = filterClasses(removedClasses, rules);
            if (addedClasses.length === addedIgnored.length && removedClasses.length === removedIgnored.length) {
              ignored++;
              continue;
            }
            attributeChanges++;
            if (addedInteresting.length > 0 || removedInteresting.length > 0) {
              notable.push({
                type: "attribute",
                selector: getSelector(el),
                tagName: el.tagName.toLowerCase(),
                id: el.id || undefined,
                attribute: "class",
                oldValue: removedInteresting.length > 0 ? `-${removedInteresting.join(" -")}` : undefined,
                newValue: addedInteresting.length > 0 ? `+${addedInteresting.join(" +")}` : undefined
              });
            }
          } else {
            attributeChanges++;
            const isInteresting = isInterestingAttribute(attrName, rules);
            if (isInteresting) {
              notable.push({
                type: "attribute",
                selector: getSelector(el),
                tagName: el.tagName.toLowerCase(),
                id: el.id || undefined,
                attribute: attrName,
                oldValue: m.oldValue || undefined,
                newValue: el.getAttribute(attrName) || undefined
              });
            }
          }
        } else if (m.type === "characterData") {
          textChanges++;
        }
      }
      if (added === 0 && removed === 0 && attributeChanges === 0 && textChanges === 0) {
        return;
      }
      const batch = {
        timestamp: Date.now(),
        count: mutations.length,
        summary: { added, removed, attributeChanges, textChanges },
        notable: notable.slice(0, 20)
      };
      if (ignored > 0) {
        batch.ignored = ignored;
      }
      this.send("mutations", "batch", batch);
    }
    watchEvents(req, watchId) {
      const target = req.selector ? document.querySelector(req.selector) : document;
      if (!target) {
        this.respond(watchId, false, null, `Element not found: ${req.selector}`);
        return;
      }
      const handlers = [];
      for (const eventType of req.events) {
        const handler = (e) => {
          const recorded = this.recordEvent(e);
          this.send("events", "captured", recorded);
          if (this.recording) {
            this.recording.events.push(recorded);
          }
        };
        target.addEventListener(eventType, handler, {
          capture: req.capture,
          passive: req.passive
        });
        handlers.push([eventType, handler]);
      }
      this.eventWatchers.set(watchId, () => {
        for (const [type, handler] of handlers) {
          target.removeEventListener(type, handler);
        }
      });
      this.respond(watchId, true, { watchId });
    }
    recordEvent(e) {
      const target = e.target;
      const recorded = {
        type: e.type,
        timestamp: Date.now(),
        target: {
          selector: getSelector(target),
          tagName: target.tagName?.toLowerCase() || "",
          id: target.id || undefined,
          className: target.className?.toString() || undefined,
          textContent: target.textContent?.slice(0, 100) || undefined,
          value: target.value || undefined
        }
      };
      if (e instanceof MouseEvent) {
        recorded.position = {
          x: e.pageX,
          y: e.pageY,
          clientX: e.clientX,
          clientY: e.clientY
        };
        recorded.modifiers = {
          alt: e.altKey,
          ctrl: e.ctrlKey,
          meta: e.metaKey,
          shift: e.shiftKey
        };
      }
      if (e instanceof KeyboardEvent) {
        recorded.key = e.key;
        recorded.code = e.code;
        recorded.modifiers = {
          alt: e.altKey,
          ctrl: e.ctrlKey,
          meta: e.metaKey,
          shift: e.shiftKey
        };
      }
      if (e.type === "input" || e.type === "change") {
        recorded.value = e.target.value;
      }
      return recorded;
    }
    clearEventWatchers() {
      this.eventWatchers.forEach((unwatch) => unwatch());
      this.eventWatchers.clear();
    }
    dispatchSyntheticEvent(req, responseId) {
      const el = document.querySelector(req.selector);
      if (!el) {
        this.respond(responseId, false, null, `Element not found: ${req.selector}`);
        return;
      }
      try {
        const opts = req.options || {};
        let event;
        if (req.event === "click" || req.event === "mousedown" || req.event === "mouseup") {
          event = new MouseEvent(req.event, {
            bubbles: opts.bubbles ?? true,
            cancelable: opts.cancelable ?? true,
            clientX: opts.clientX,
            clientY: opts.clientY,
            button: opts.button ?? 0
          });
        } else if (req.event === "keydown" || req.event === "keyup" || req.event === "keypress") {
          event = new KeyboardEvent(req.event, {
            bubbles: opts.bubbles ?? true,
            cancelable: opts.cancelable ?? true,
            key: opts.key,
            code: opts.code,
            altKey: opts.altKey,
            ctrlKey: opts.ctrlKey,
            metaKey: opts.metaKey,
            shiftKey: opts.shiftKey
          });
        } else if (req.event === "input") {
          if (opts.value !== undefined && "value" in el) {
            el.value = opts.value;
          }
          event = new InputEvent(req.event, {
            bubbles: opts.bubbles ?? true,
            cancelable: opts.cancelable ?? true,
            inputType: opts.inputType || "insertText",
            data: opts.value
          });
        } else if (req.event === "focus") {
          el.focus();
          this.respond(responseId, true);
          return;
        } else if (req.event === "blur") {
          el.blur();
          this.respond(responseId, true);
          return;
        } else {
          event = new CustomEvent(req.event, {
            bubbles: opts.bubbles ?? true,
            cancelable: opts.cancelable ?? true,
            detail: opts.detail
          });
        }
        el.dispatchEvent(event);
        this.respond(responseId, true);
      } catch (err) {
        this.respond(responseId, false, null, err.message);
      }
    }
    async replaySession(session, speed, responseId) {
      const events = session.events;
      let lastTime = events[0]?.timestamp || 0;
      for (const event of events) {
        const delay = (event.timestamp - lastTime) / speed;
        lastTime = event.timestamp;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        await new Promise((resolve) => {
          this.dispatchSyntheticEvent({
            selector: event.target.selector,
            event: event.type,
            options: {
              clientX: event.position?.clientX,
              clientY: event.position?.clientY,
              key: event.key,
              code: event.code,
              altKey: event.modifiers?.alt,
              ctrlKey: event.modifiers?.ctrl,
              metaKey: event.modifiers?.meta,
              shiftKey: event.modifiers?.shift,
              value: event.value
            }
          }, uid());
          resolve();
        });
      }
      this.respond(responseId, true);
    }
    interceptConsole() {
      const levels = ["log", "info", "warn", "error", "debug"];
      for (const level of levels) {
        this.originalConsole[level] = console[level];
        console[level] = (...args) => {
          this.originalConsole[level].apply(console, args);
          const entry = {
            level,
            args: args.map((arg) => {
              try {
                return JSON.parse(JSON.stringify(arg));
              } catch {
                return String(arg);
              }
            }),
            timestamp: Date.now()
          };
          if (level === "error") {
            entry.stack = new Error().stack;
          }
          this.consoleBuffer.push(entry);
          if (this.consoleBuffer.length > 1000) {
            this.consoleBuffer = this.consoleBuffer.slice(-500);
          }
          if (level === "error") {
            if (this.state === "connected") {
              this.send("console", level, entry);
            }
            this.updateUI();
          }
        };
      }
    }
    restoreConsole() {
      for (const [level, fn] of Object.entries(this.originalConsole)) {
        if (fn) {
          console[level] = fn;
        }
      }
    }
  }
  function registerDevChannel() {
    if (customElements.get(TAG_NAME)) {
      currentTagName = TAG_NAME;
      return;
    }
    customElements.define(TAG_NAME, DevChannel);
    currentTagName = TAG_NAME;
  }
  registerDevChannel();
  function inject(serverUrl2 = "wss://localhost:8700/ws/browser") {
    const existingId = window.__haltija_widget_id__;
    if (existingId) {
      const existing = document.getElementById(existingId);
      if (existing) {
        console.log(`${LOG_PREFIX} Already injected`);
        const existingVersion = existing.getAttribute("data-version") || "0.0.0";
        if (existingVersion !== VERSION2) {
          console.log(`${LOG_PREFIX} Version mismatch (${existingVersion} -> ${VERSION2}), replacing`);
          existing.remove();
          window.__haltija_widget_id__ = null;
        } else {
          return existing;
        }
      }
    }
    const widgetId = "haltija-" + Math.random().toString(36).slice(2);
    window.__haltija_widget_id__ = widgetId;
    const el = DevChannel.elementCreator()();
    el.id = widgetId;
    el.setAttribute("server", serverUrl2);
    el.setAttribute("data-version", VERSION2);
    document.body.appendChild(el);
    console.log(`${LOG_PREFIX} Injected (${widgetId})`);
    return el;
  }
  function autoInject() {
    if (typeof window === "undefined")
      return;
    const config = window.__haltija_config__;
    if (config?.autoInject !== false) {
      if (config) {
        inject(config.serverUrl || config.wsUrl);
        return;
      }
    }
    try {
      const scripts = document.querySelectorAll('script[src*="component.js"]');
      for (const script of scripts) {
        const src = script.getAttribute("src");
        if (!src)
          continue;
        const url = new URL(src, location.href);
        if (url.searchParams.get("autoInject") === "true") {
          const serverUrl2 = url.searchParams.get("serverUrl") || url.searchParams.get("wsUrl");
          inject(serverUrl2 || undefined);
          return;
        }
      }
    } catch {}
  }
  if (typeof window !== "undefined") {
    window.DevChannel = DevChannel;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", autoInject);
    } else {
      autoInject();
    }
  }
})();
