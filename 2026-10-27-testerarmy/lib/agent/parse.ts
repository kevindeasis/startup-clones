import type { Action } from './actions';

const Q = `["“”']`;
const quoted = `${Q}([^"“”']+)${Q}`;

function clean(s: string) {
  return s.trim().replace(/^(the|a|an)\s+/i, '').trim();
}

/** Parse one natural-language step/assertion into an Action, or null. Used by the mock planner. */
export function parseStep(raw: string): Action | null {
  const s = raw.trim().replace(/[.]+$/, '');
  let m: RegExpMatchArray | null;

  // assertions first (they may contain words like "click")
  m = s.match(new RegExp(`url\\s+contains\\s+${quoted}`, 'i'));
  if (m) return { type: 'assert_url_contains', fragment: m[1] };

  m = s.match(new RegExp(`^(?:expect|verify|check|assert)\\s+(?:that\\s+)?${quoted}`, 'i'));
  if (m) return { type: 'assert_text', text: m[1] };
  m = s.match(new RegExp(`page\\s+contains\\s+${quoted}`, 'i'));
  if (m) return { type: 'assert_text', text: m[1] };

  m = s.match(/^wait\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  if (m) return { type: 'wait', ms: Math.min(5000, Math.round(parseFloat(m[1]) * 1000)) };

  m = s.match(/^(?:go\s+to|open|navigate\s+to)\s+(\S+)/i);
  if (m) return { type: 'goto', url: m[1].replace(new RegExp(`^${Q}|${Q}$`, 'g'), '') };

  m = s.match(/^press\s+(?:the\s+)?(?:key\s+)?["“”']?([A-Za-z0-9+]+)["“”']?/i);
  if (m) return { type: 'press', key: m[1] };

  // select "value" in field
  m = s.match(new RegExp(`^select\\s+${quoted}\\s+(?:in|from)(?:to)?\\s+(.+)$`, 'i'));
  if (m) return { type: 'select', value: m[1], target: stripField(m[2]) };

  // type "value" in/into [the] "field"
  m = s.match(new RegExp(`^(?:type|enter|fill(?:\\s+in)?)\\s+${quoted}\\s+in(?:to)?\\s+(.+)$`, 'i'));
  if (m) return { type: 'fill', value: m[1], target: stripField(m[2]) };

  // fill <field> with <value>
  m = s.match(/^fill(?:\s+in)?\s+(.+?)\s+with\s+(.+)$/i);
  if (m) {
    return {
      type: 'fill',
      target: stripField(m[1]),
      value: m[2].trim().replace(new RegExp(`^${Q}|${Q}$`, 'g'), ''),
    };
  }

  // click [on] [the] "x" | x [button|link|checkbox]
  m = s.match(/^click(?:\s+on)?\s+(.+)$/i);
  if (m) {
    const qm = m[1].match(new RegExp(quoted));
    if (qm) return { type: 'click', target: qm[1] };
    return { type: 'click', target: m[1].replace(/\s+(button|link|checkbox)$/i, '').replace(/^(the|a)\s+/i, '').trim() };
  }

  return null;
}

function stripField(f: string) {
  const qm = f.match(new RegExp(quoted));
  if (qm) return qm[1];
  return clean(f).replace(/\s+(field|input|box|textbox)$/i, '');
}

export const MOCK_CANNOT_INTERPRET =
  'mock planner cannot interpret this step; set ANTHROPIC_API_KEY for the LLM planner';
