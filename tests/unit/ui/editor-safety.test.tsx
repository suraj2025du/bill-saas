// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useStore } from '../../../src/store/store';
import { buildSampleData } from '../../../src/data/seed';
import { PartyDetail } from '../../../src/features/parties/Parties';
import { partyLedgerId } from '../../../src/core/ledgers';
import { newVoucher } from '../../../src/core/factories';
import { App } from '../../../src/App';
import { toast } from '../../../src/ui/feedback';
import type { CollectionData } from '../../../src/core/model';
import { defaultSettings } from '../../../src/core/factories';

vi.mock('../../../src/store/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/store/store')>();
  return {
    ...actual,
    boot: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('../../../src/ui/feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/feedback')>();
  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: vi.fn(),
      success: vi.fn(),
    },
    confirmDialog: vi.fn(() => Promise.resolve(true)),
  };
});

describe('Batch 07 Safety Regression Tests', () => {
  let data: CollectionData;

  beforeEach(() => {
    data = buildSampleData();
    // Clear toast mocks
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
  });

  afterEach(cleanup);

  it('blocks deleting a party if any voucher line references its ledger (FU1)', async () => {
    // Add a voucher referencing a party ledger
    const party = data.clients[0];
    const pLedgerId = partyLedgerId(party.id);
    const voucher = newVoucher(data.businesses[0].id, 'RECEIPT', {
      number: 'RV/26-27/9999',
      date: '2026-10-25',
      lines: [
        { ledgerId: 'sys:cash', dr: 100, cr: 0, docId: '', note: '' },
        { ledgerId: pLedgerId, dr: 0, cr: 100, docId: '', note: '' },
      ],
    });
    data.vouchers.push(voucher);

    useStore.setState({ data, adapter: null, boot: 'ready', unlocked: true });

    render(
      <MemoryRouter initialEntries={[`/parties/${party.id}`]}>
        <Routes>
          <Route path="/parties/:id" element={<PartyDetail />} />
        </Routes>
      </MemoryRouter>
    );

    // Locate the Delete button and click it
    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    deleteBtn.click();

    // Verify it is blocked and toast error is fired
    expect(toast.error).toHaveBeenCalledWith('This party has invoices, bills or payments. It cannot be deleted.');
  });

  it('renders LockScreen as overlay when locked and ready (CR Y2)', () => {
    // Merge PIN into the existing app settings to keep setupComplete and activeBusinessId intact
    const dummyPin = { hash: 'dummyhash', salt: 'dummysalt', iterations: 10000 };
    const appSettings = data.settings.find((s) => s.id === 'app');
    if (appSettings) {
      appSettings.pin = dummyPin;
      appSettings.setupComplete = true;
    } else {
      data.settings.push({ ...defaultSettings(), id: 'app', pin: dummyPin, setupComplete: true });
    }

    useStore.setState({
      data,
      adapter: null,
      boot: 'ready',
      unlocked: false, // Locked!
    });

    render(<App />);

    // Lock screen overlay elements should be visible
    expect(screen.getByLabelText('PIN')).toBeTruthy();
  });
});
