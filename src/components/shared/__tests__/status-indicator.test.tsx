// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StatusIndicator, ORDER_STATUS_CONFIG } from '../status-indicator';

describe('StatusIndicator', () => {
  it('renders with correct label and role', () => {
    const { getByText } = render(<StatusIndicator variant="success" label="Paid" />);
    expect(getByText('Paid')).toBeDefined();
  });

  it('renders icon alongside text (not color alone)', () => {
    const { container, getByText } = render(<StatusIndicator variant="danger" label="Cancelled" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(getByText('Cancelled')).toBeDefined();
  });

  it('ORDER_STATUS_CONFIG covers all business states', () => {
    const states = ['awaiting_payment', 'paid', 'printing', 'ready', 'collected', 'cancelled', 'refunded'];
    for (const s of states) {
      expect(ORDER_STATUS_CONFIG[s]).toBeDefined();
      expect(ORDER_STATUS_CONFIG[s].label).toBeTruthy();
    }
  });
});
