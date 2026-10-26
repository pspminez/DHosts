import { planGuestMessage } from "./routing.js";

const DEMO_PROPERTY = {
  secrets: [],
  answers: [
    { topic: "Wi-Fi", keywords: ["wifi", "internet", "network"], reply: "For this sample property, ask the host for Wi-Fi access. No network credentials are provided in the demo." },
    { topic: "Checkout", keywords: ["checkout", "check out", "departure"], reply: "Sample checkout time is 10:00 AM. Confirm actual times with your host." },
    { topic: "Trash", keywords: ["trash", "garbage", "bins"], reply: "Sample trash pickup is Tuesday morning; bins go out Monday night." },
    { topic: "Parking", keywords: ["parking", "cars", "driveway"], reply: "The sample property allows two cars in the driveway; confirm parking rules with your host." },
    { topic: "Pets", keywords: ["pets", "dogs", "cats"], reply: "The sample property's policy is no pets." },
    { topic: "Quiet Hours", keywords: ["quiet hours", "noise"], reply: "Sample quiet hours are 10 PM to 8 AM." },
    { topic: "Gate Access", keywords: ["gate", "gate code", "door code", "access code"], reply: "The demo does not provide access codes. Contact your host through your booking app." },
  ],
};

export function previewDemoMessage(guestMessage) {
  const route = planGuestMessage(guestMessage, DEMO_PROPERTY);
  let reply = "I can't confirm that from the sample property's information. Please contact your host directly.";
  if (route.action === "answer" && route.answer) {
    reply = route.answer.text;
  } else if (route.action === "clarify") {
    reply = route.intentKey === "message_too_long"
      ? "That message is too long for this sample. Please try a shorter property question."
      : "I’m not sure what you need. Try asking about checkout, trash, parking, pets, or quiet hours.";
  } else if (route.action === "off_topic") {
    reply = "This sample only demonstrates property-stay questions. Please contact your host for other help.";
  } else if (route.action === "emergency") {
    reply = "This is a demo and cannot contact a host. Move to safety and call 911 now if there is immediate danger.";
  } else if (route.action === "escalate") {
    reply = "This is a demo and cannot contact a host. For an actual safety, legal, billing, or damage issue, use your booking app to contact the host.";
  }
  return {
    reply,
    action: route.action,
    risk: route.risk,
    intentKey: route.intentKey,
    aiCalled: false,
    smsSent: false,
  };
}
