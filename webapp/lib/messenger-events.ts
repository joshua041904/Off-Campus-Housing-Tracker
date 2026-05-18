/** Dispatched on `window` to open the global message dock with compose prefilled. */
export const OCH_MESSENGER_PREFILL_EVENT = "och-messenger-prefill";

export type OchMessengerPrefillDetail = {
  recipientUuid?: string;
  subject?: string;
};
