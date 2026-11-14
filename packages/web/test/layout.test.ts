import { describe, expect, it } from 'vitest';
import { bentoAreas } from '../src/layout';

const all = { does: true, risk: true, parts: true, steps: true };

describe('bentoAreas', () => {
  it('puts parts on the left, the summary then the risks on the right, steps across the bottom', () => {
    expect(bentoAreas(all)).toEqual({
      wide: "'cmd label' 'parts does' 'parts risk' 'steps steps'",
      narrow: "'cmd' 'label' 'does' 'risk' 'parts' 'steps'",
    });
  });

  it('drops rows for missing cards so no gaps are left', () => {
    expect(bentoAreas({ ...all, risk: false }).wide).toBe("'cmd label' 'parts does' 'steps steps'");
    expect(bentoAreas({ does: true, risk: true, parts: false, steps: false }).wide).toBe("'cmd label' 'does does' 'risk risk'");
    expect(bentoAreas({ does: false, risk: false, parts: true, steps: false }).wide).toBe("'cmd label' 'parts parts'");
    expect(bentoAreas({ does: false, risk: false, parts: false, steps: false })).toEqual({ wide: "'cmd label'", narrow: "'cmd' 'label'" });
  });
});
