import { planGuestMessage } from "./routing.js";

// Demo-only property. The credentials below are fake and exist to match the
// hero mock on the landing page; never copy real property credentials here.
const DEMO_PROPERTY = {
  secrets: [],
  answers: [
    { topic: "Wi-Fi", keywords: ["wifi", "wi-fi", "internet", "network", "password"], reply: "Network: CedarGuest · Password: porch-light-42" },
    { topic: "Check-in", keywords: ["check-in", "check in", "checkin", "arrival"], reply: "Check-in starts at 3pm. Door and lockbox codes aren't included in the demo — your host shares access details directly." },
    { topic: "Checkout", keywords: ["checkout", "check out", "departure"], reply: "Sample checkout time is 10:00 AM. Confirm actual times with your host." },
    { topic: "Trash", keywords: ["trash", "garbage", "bins"], reply: "Sample trash pickup is Tuesday morning; bins go out Monday night." },
    { topic: "Parking", keywords: ["parking", "cars", "driveway"], reply: "The sample property allows two cars in the driveway; confirm parking rules with your host." },
    { topic: "Quiet Hours", keywords: ["quiet hours", "noise"], reply: "Sample quiet hours are 10 PM to 8 AM." },
    { topic: "Gate Access", keywords: ["gate", "gate code", "door code", "access code"], reply: "The demo does not provide access codes. Contact your host through your booking app." },
  ],
};

export function previewDemoMessage(guestMessage) {
  const route = planGuestMessage(guestMessage, DEMO_PROPERTY);
  let action = route.action;
  let reply = "I can't confirm that from the sample property's information. Please contact your host directly.";

  if (route.action === "answer" && route.answer) {
    reply = route.answer.text;
  } else if (route.action === "clarify") {
    reply = route.intentKey === "message_too_long"
      ? "That message is too long for this sample. Please try a shorter property question."
      : "I’m not sure what you need. Try asking about checkout, trash, parking, pets, or quiet hours.";
  } else if (route.action === "ai") {
    // A legitimate stay question the sample guide simply does not cover.
    action = "not_covered";
    reply = "That isn't covered by the sample property's guide, so on a real property it would be handed to the host with your question and number attached.";
  } else if (route.action === "off_topic") {
    reply = "This sample only demonstrates property-stay questions. Please contact your host for other help.";
  } else if (route.action === "emergency") {
    reply = "This is a demo and cannot contact a host. Move to safety and call 911 now if there is immediate danger.";
  } else if (route.action === "escalate") {
    reply = "This is a demo and cannot contact a host. For an actual safety, legal, billing, or damage issue, use your booking app to contact the host.";
  }
  return {
    reply,
    action,
    risk: route.risk,
    intentKey: route.intentKey,
    aiCalled: false,
    smsSent: false,
  };
}
