// StayXI landing page behavior: nav, reveals, sample chat,
// product-view tabs, FAQ accordion and the trial lead form.
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Navigation ---------- */

  var nav = document.getElementById("siteNav");
  var menuBtn = document.getElementById("menuBtn");
  var mobileMenu = document.getElementById("mobileMenu");

  // Reading scrollY inside the scroll handler forces a layout on every event,
  // and re-toggling the class repaints the blurred nav even when the state did
  // not change. Batch to one frame and only touch the DOM on a real change.
  var scrolled = null;
  var scrollFrame = 0;

  function applyScrollState() {
    scrollFrame = 0;
    if (!nav) return;
    var next = window.scrollY > 12;
    if (next === scrolled) return;
    scrolled = next;
    nav.classList.toggle("scrolled", next);
  }

  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(applyScrollState);
  }

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  function setMenu(open) {
    if (!menuBtn || !mobileMenu || !nav) return;
    mobileMenu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    nav.classList.toggle("menu-open", open);
    document.body.classList.toggle("menu-open", open);
  }

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", function () {
      setMenu(mobileMenu.hidden);
    });
    mobileMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setMenu(false);
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !mobileMenu.hidden) setMenu(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 768 && !mobileMenu.hidden) setMenu(false);
    });
  }

  /* ---------- Aurora ---------- */

  // The blurred aurora spans are expensive to composite. Stop them while the
  // hero is offscreen instead of animating a region nobody can see.
  var hero = document.querySelector(".hero");

  if (hero && "IntersectionObserver" in window) {
    var heroObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        document.documentElement.classList.toggle("hero-away", !entry.isIntersecting);
      });
    });
    heroObserver.observe(hero);
  }

  /* ---------- Scroll reveals ---------- */

  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- Sample conversation ---------- */

  // These are only the offered questions. Every answer comes from the Worker's
  // /api/chat endpoint, so the page demonstrates the real demo routing instead
  // of a local script pretending to be one.
  var samplePrompts = [
    "What is the Wi-Fi password?",
    "What time is check-in?",
    "Where do we park?",
    "Which bin goes out tonight?",
    "Can we bring our dog?"
  ];

  var SAMPLE_SECTIONS = {
    faq_wi_fi: "Wi-Fi & parking",
    faq_parking: "Wi-Fi & parking",
    faq_check_in: "Check-in & arrival",
    faq_checkout: "Departure",
    faq_trash: "Departure",
    faq_quiet_hours: "House rules",
    faq_gate_access: "Access details"
  };

  var sampleBox = document.getElementById("sampleMessages");
  var promptBox = document.getElementById("samplePrompts");
  var sampleForm = document.getElementById("sampleForm");
  var sampleInput = document.getElementById("sampleInput");
  var sampleSend = document.getElementById("sampleSend");
  var resetBtn = document.getElementById("resetSample");
  var sampleIntro = sampleBox ? sampleBox.innerHTML : "";
  var sampleBusy = false;
  var sampleGeneration = 0;

  function scrollSample() {
    if (sampleBox) sampleBox.scrollTop = sampleBox.scrollHeight;
  }

  function addBubble(from, text, source, routed) {
    if (!sampleBox) return;
    var wrap = document.createElement("div");
    wrap.className = "msg " + from;

    var label = document.createElement("span");
    label.className = "msg-label";
    label.textContent = from === "guest" ? "Guest" : "StayXI";

    var bubble = document.createElement("p");
    bubble.className = "msg-text" + (routed ? " routed" : "");
    bubble.textContent = text;

    wrap.appendChild(label);
    wrap.appendChild(bubble);

    if (source) {
      var chip = document.createElement("span");
      chip.className = "msg-source" + (routed ? " routed" : "");
      chip.textContent = source;
      wrap.appendChild(chip);
    }

    sampleBox.appendChild(wrap);
    scrollSample();
  }

  function setSampleBusy(busy) {
    sampleBusy = busy;
    if (sampleSend) sampleSend.disabled = busy;
    if (!promptBox) return;
    promptBox.querySelectorAll("button").forEach(function (button) {
      button.disabled = busy;
    });
  }

  function removeTyping(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function sampleOutcome(data) {
    if (data.action === "answer") {
      var source = data.intentKey === "faq_gate_access"
        ? "Sample guide · access codes withheld"
        : "Answered from Guide · " + (SAMPLE_SECTIONS[data.intentKey] || "Sample guide");
      return { text: data.reply, source: source, routed: false };
    }
    if (data.action === "emergency") {
      return { text: data.reply, source: "Safety reply · call 911 if there is danger", routed: true };
    }
    if (data.action === "escalate") {
      return { text: data.reply, source: "Routed to host · high-risk question", routed: true };
    }
    if (data.action === "not_covered") {
      return { text: data.reply, source: "Routed to host · not covered by the sample guide", routed: true };
    }
    if (data.action === "off_topic") {
      return { text: data.reply, source: "Outside property questions", routed: false };
    }
    if (data.action === "clarify") {
      return { text: data.reply, source: "Needs a clearer question", routed: false };
    }
    return { text: data.reply, source: "Sample reply", routed: false };
  }

  function askSample(question, button) {
    if (sampleBusy) return;
    var generation = ++sampleGeneration;
    setSampleBusy(true);
    if (button) button.classList.add("done");
    addBubble("guest", question);

    var typing = document.createElement("div");
    typing.className = "typing";
    typing.setAttribute("aria-label", "StayXI is replying");
    for (var i = 0; i < 3; i += 1) typing.appendChild(document.createElement("span"));
    if (sampleBox) {
      sampleBox.appendChild(typing);
      scrollSample();
    }

    import("./api.js")
      .then(function (api) { return api.sendDemoMessage(question); })
      .then(function (data) {
        if (generation !== sampleGeneration) return;
        removeTyping(typing);
        // The demo limit comes back as a 200 with a friendly reply and an error
        // code, so surface that reply instead of the generic outage message.
        if (data && data.error) {
          var limited = new Error(data.error);
          limited.userMessage = data.reply;
          throw limited;
        }
        if (!data || typeof data.reply !== "string" || !data.reply) {
          throw new Error("The sample line returned an empty reply.");
        }
        var outcome = sampleOutcome(data);
        addBubble("bot", outcome.text, outcome.source, outcome.routed);
      })
      .catch(function (error) {
        if (generation !== sampleGeneration) return;
        removeTyping(typing);
        var message = error && error.userMessage
          ? error.userMessage
          : "The sample line is unavailable right now. Please try again, or email hello@stayxi.com.";
        addBubble("bot", message, "Demo unavailable", true);
      })
      .then(function () {
        if (generation !== sampleGeneration) return;
        setSampleBusy(false);
      });
  }

  if (promptBox) {
    samplePrompts.forEach(function (question) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "prompt";
      button.textContent = question;
      button.addEventListener("click", function () { askSample(question, button); });
      promptBox.appendChild(button);
    });
  }

  if (sampleForm && sampleInput) {
    sampleForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (sampleBusy) return;
      var question = sampleInput.value.trim();
      if (!question) {
        sampleInput.focus();
        return;
      }
      sampleInput.value = "";
      askSample(question, null);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      sampleGeneration += 1;
      setSampleBusy(false);
      if (sampleBox) {
        sampleBox.innerHTML = sampleIntro;
        scrollSample();
      }
      if (sampleInput) sampleInput.value = "";
      if (promptBox) {
        promptBox.querySelectorAll(".prompt.done").forEach(function (button) {
          button.classList.remove("done");
        });
      }
    });
  }

  /* ---------- Showcase tabs ---------- */

  var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-showcase-tab]"));
  var panels = Array.prototype.slice.call(document.querySelectorAll("[data-showcase-panel]"));

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var key = tab.getAttribute("data-showcase-tab");
      tabs.forEach(function (other) {
        var active = other === tab;
        other.classList.toggle("active", active);
        other.setAttribute("aria-selected", active ? "true" : "false");
      });
      panels.forEach(function (panel) {
        panel.hidden = panel.getAttribute("data-showcase-panel") !== key;
      });
    });
  });

  /* ---------- FAQ ---------- */

  var faqItems = Array.prototype.slice.call(document.querySelectorAll(".faq-item"));

  faqItems.forEach(function (item) {
    var button = item.querySelector(".faq-q");
    if (!button) return;
    button.addEventListener("click", function () {
      var wasOpen = item.classList.contains("open");
      faqItems.forEach(function (other) {
        other.classList.remove("open");
        var otherButton = other.querySelector(".faq-q");
        if (otherButton) otherButton.setAttribute("aria-expanded", "false");
      });
      if (!wasOpen) {
        item.classList.add("open");
        button.setAttribute("aria-expanded", "true");
      }
    });
  });

  /* ---------- Trial lead form ---------- */

  var form = document.getElementById("trialForm");
  var emailInput = document.getElementById("trialEmail");
  var submitBtn = document.getElementById("trialSubmit");
  var successBox = document.getElementById("trialSuccess");
  var errorBox = document.getElementById("trialError");

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  if (form && emailInput && submitBtn) {
    var label = submitBtn.querySelector(".btn-label");

    emailInput.addEventListener("input", function () {
      if (errorBox) errorBox.hidden = true;
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (errorBox) errorBox.hidden = true;

      var email = emailInput.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError("Enter a valid email address.");
        emailInput.focus();
        return;
      }

      submitBtn.disabled = true;
      if (label) label.textContent = "Sending…";

      import("./api.js")
        .then(function (api) { return api.submitLead(email); })
        .then(function () {
          form.hidden = true;
          if (successBox) successBox.hidden = false;
        })
        .catch(function (error) {
          showError(error instanceof Error ? error.message : "Something went wrong. Email hello@stayxi.com instead.");
          submitBtn.disabled = false;
          if (label) label.textContent = "Request the trial";
        });
    });
  }
})();
