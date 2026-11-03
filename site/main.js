// StayXI landing page behavior: nav, reveals, counters, sample chat,
// product-view tabs, FAQ accordion and the trial lead form.
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Navigation ---------- */

  var nav = document.getElementById("siteNav");
  var menuBtn = document.getElementById("menuBtn");
  var mobileMenu = document.getElementById("mobileMenu");

  function onScroll() {
    if (nav) nav.classList.toggle("scrolled", window.scrollY > 12);
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

  /* ---------- Metric counters ---------- */

  function runCounter(el) {
    var target = Number(el.getAttribute("data-count") || 0);
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    var duration = 1600;
    var started = null;

    function frame(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / duration);
      var eased = 1 - Math.pow(1 - t, 4);
      el.textContent = prefix + Math.round(target * eased).toLocaleString("en-US") + suffix;
      if (t < 1) window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  var counters = Array.prototype.slice.call(document.querySelectorAll("[data-count]"));
  if (reduceMotion || !("IntersectionObserver" in window)) {
    counters.forEach(function (el) {
      el.textContent = (el.getAttribute("data-prefix") || "") +
        Number(el.getAttribute("data-count") || 0).toLocaleString("en-US") +
        (el.getAttribute("data-suffix") || "");
    });
  } else {
    var counterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          runCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: "-10% 0px" });
    counters.forEach(function (el) { counterObserver.observe(el); });
  }

  /* ---------- Sample conversation ---------- */

  var replies = [
    {
      q: "What is the wifi password?",
      a: "Network: CedarGuest · Password: porch-light-42",
      source: "Wifi & parking"
    },
    {
      q: "What time is check-in?",
      a: "Check-in starts at 3pm. Door and lockbox codes aren't included in the demo — your host shares access details directly.",
      source: "Check-in & arrival"
    },
    {
      q: "Where do we park?",
      a: "One car in the driveway. A second car can park on the street past the mailbox.",
      source: "Wifi & parking"
    },
    {
      q: "Which bin goes out tonight?",
      a: "Trash goes out Tuesday night; recycling every other Thursday.",
      source: "Departure"
    },
    {
      q: "Can we bring our dog?",
      a: "That is not in the guide, so it comes to you with the guest and the question attached.",
      source: "No guide match",
      routed: true
    }
  ];

  var sampleBox = document.getElementById("sampleMessages");
  var promptBox = document.getElementById("samplePrompts");
  var resetBtn = document.getElementById("resetSample");
  var sampleIntro = sampleBox ? sampleBox.innerHTML : "";
  var sampleBusy = false;
  var sampleTimer = null;

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
      chip.textContent = routed
        ? "Routed to you · " + source
        : "Answered from Guide · " + source;
      wrap.appendChild(chip);
    }

    sampleBox.appendChild(wrap);
    scrollSample();
  }

  function setSampleBusy(busy) {
    sampleBusy = busy;
    if (!promptBox) return;
    promptBox.querySelectorAll("button").forEach(function (button) {
      button.disabled = busy;
    });
  }

  function askSample(index, button) {
    if (sampleBusy || !replies[index]) return;
    var reply = replies[index];
    setSampleBusy(true);
    if (button) button.classList.add("done");
    addBubble("guest", reply.q);

    var typing = document.createElement("div");
    typing.className = "typing";
    typing.setAttribute("aria-label", "StayXI is replying");
    for (var i = 0; i < 3; i += 1) typing.appendChild(document.createElement("span"));
    if (sampleBox) {
      sampleBox.appendChild(typing);
      scrollSample();
    }

    sampleTimer = window.setTimeout(function () {
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      addBubble("bot", reply.a, reply.source, reply.routed);
      setSampleBusy(false);
      sampleTimer = null;
    }, 850);
  }

  if (promptBox) {
    replies.forEach(function (reply, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "prompt";
      button.textContent = reply.q;
      button.addEventListener("click", function () { askSample(index, button); });
      promptBox.appendChild(button);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      if (sampleTimer !== null) window.clearTimeout(sampleTimer);
      sampleTimer = null;
      setSampleBusy(false);
      if (sampleBox) {
        sampleBox.innerHTML = sampleIntro;
        scrollSample();
      }
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
        other.setAttribute("aria-pressed", active ? "true" : "false");
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
          if (label) label.textContent = "Start the trial";
        });
    });
  }
})();
