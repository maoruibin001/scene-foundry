/** API and CLI errors share this rule before any reconnect, timeout or rate-limit hint. */
export function externalProviderBlock(error:unknown):boolean {
 const text=String(error??'');
 if(/PROVIDER_HTTP_(?:401|402|403)\b|\b(?:401 Unauthorized|402 Payment Required|403 Forbidden)\b/i.test(text))return true;
 // CLI transports may retain the HTTP status instead of emitting PROVIDER_HTTP_NNN.
 if(/\b(?:HTTP(?:\/\d(?:\.\d)?)?\s*[:=]?\s*|(?:unexpected\s+)?status(?:\s+code)?\s*[:=]?\s*)(?:401|402|403)\b|["']status["']\s*:\s*(?:401|402|403)\b/i.test(text))return true;
 return /\b(?:UserBudgetExhausted|insufficient[_ -](?:quota|budget)|(?:no|not)\s+(?:sufficient|enough)\s+(?:budget|credits?)|quota[_ -](?:exceeded|exhausted)|usage[_ -]limit|invalid[._ -]?api[._ -]?key|unauthori[sz]ed|authentication failed|payment required)\b|余额不足|额度耗尽/i.test(text);
}
