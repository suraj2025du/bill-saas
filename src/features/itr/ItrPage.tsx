import { Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { SUPPORTED_FYS, computeItr, defaultFilingDate, emptyItrInput } from '../../core/itr/incomeTax';
import type { AgeGroup, BusinessMode, ItrInput, RegimeResult, SupportedFy } from '../../core/itr/incomeTax';
import { profitAndLoss } from '../../core/accounting/reports';
import { fyFromLabel } from '../../core/dates';
import { ReportDocument } from '../../print/SimpleDocuments';
import { pageSpec, printNode } from '../../print/printing';
import { useBooks, useBusiness } from '../../store/hooks';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, NumberInput, PageHeader, Select, cx } from '../../ui/kit';
import { fdate, useMoney } from '../../ui/money';

const STORE_KEY = 'fgb:itr';

function Num({ label, value, onValue, hint }: { label: string; value: number; onValue: (n: number) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <NumberInput value={value} emptyZero onValue={onValue} />
    </Field>
  );
}

function RegimeCard({ r, best, fy, money }: { r: RegimeResult; best: boolean; fy: SupportedFy; money: (n: number) => string }) {
  const newAct = fy === '2026-27';
  const row = (k: ReactNode, v: number, strong = false) => (
    <div className={cx('flex justify-between py-0.5', strong && 'font-semibold')}>
      <span className="text-slate-600">{k}</span>
      <span className="tabular-nums">{money(v)}</span>
    </div>
  );
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {r.regime === 'NEW' ? 'New regime (s.115BAC)' : 'Old regime'} {best && <Badge tone="green">Lower tax</Badge>}
        </span>
      }
      className={best ? 'ring-2 ring-emerald-300' : ''}
    >
      <div className="text-sm">
        {row('Gross total income', r.grossTotalIncome)}
        {r.standardDeduction > 0 && row('Standard deduction (included above)', r.standardDeduction)}
        {r.deductionLines.map((d) => (
          <div key={d.label}>{row(`Less ${d.label}`, d.amount)}</div>
        ))}
        {row('Total income', r.totalIncome, true)}
        <div className="my-2 border-t" />
        {r.slabs
          .filter((s) => s.tax > 0)
          .map((s) => (
            <div key={s.from}>{row(`${s.rate}% on ${money(s.from)} - ${s.to ? money(s.to) : 'above'}`, s.tax)}</div>
          ))}
        {row('Tax on income', r.slabTax)}
        {r.rebate87A > 0 && row(newAct ? 'Less rebate u/s 87A (s.156)' : 'Less rebate u/s 87A', r.rebate87A)}
        {r.surcharge > 0 && row(`Surcharge${r.surchargeRelief ? ' (after marginal relief)' : ''}`, r.surcharge)}
        {row('Health & education cess 4%', r.cess)}
        <div className="mt-1 border-t pt-1 text-base">{row('Total tax', r.totalTax, true)}</div>
      </div>
    </Card>
  );
}

export function ItrPage() {
  const biz = useBusiness();
  const books = useBooks();
  const money = useMoney();
  const [input, setInput] = useState<ItrInput>(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) return { ...emptyItrInput(), ...(JSON.parse(saved) as Partial<ItrInput>) };
    } catch {
      // ignore unreadable saved data
    }
    return emptyItrInput();
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(input));
    } catch {
      // storage full or blocked: the calculator still works
    }
  }, [input]);
  const set = (patch: Partial<ItrInput>) => setInput((x) => ({ ...x, ...patch }));
  const setD = (patch: Partial<ItrInput['deductions']>) => setInput((x) => ({ ...x, deductions: { ...x.deductions, ...patch } }));
  const r = useMemo(() => computeItr(input), [input]);
  const newAct = input.fy === '2026-27';
  const hasIncome = r.old.grossTotalIncome > 0 || r.new.grossTotalIncome > 0 || r.businessIncome !== 0 || input.houseProperty !== 0;
  const regimesDiffer = r.old.totalTax !== r.new.totalTax;

  const fromBooks = () => {
    if (!books) return;
    const fy = fyFromLabel(input.fy, biz.fyStartMonth);
    const pnl = profitAndLoss(books, fy.start, fy.end);
    set({
      businessMode: 'ACTUAL',
      businessProfit: Math.round(pnl.netProfit),
      filingDate: input.filingDate === defaultFilingDate(input.fy, input.businessMode) ? defaultFilingDate(input.fy, 'ACTUAL') : input.filingDate,
    });
  };

  const print = () => {
    const best = r.better === 'NEW' ? r.new : r.old;
    printNode(
      <ReportDocument
        business={biz}
        title="Income Tax Estimate"
        subtitle={`FY ${input.fy} | ${r.better === 'NEW' ? 'New' : 'Old'} regime is lower by ${money(r.saving)}`}
        columns={[{ header: 'Particulars' }, { header: 'Old regime', align: 'right' }, { header: 'New regime', align: 'right' }]}
        rows={[
          ['Gross total income', r.old.grossTotalIncome, r.new.grossTotalIncome],
          ['Chapter VI-A deductions', r.old.deductions, r.new.deductions],
          ['Total income', r.old.totalIncome, r.new.totalIncome],
          ['Tax on income', r.old.slabTax, r.new.slabTax],
          ['Rebate u/s 87A', r.old.rebate87A, r.new.rebate87A],
          ['Surcharge', r.old.surcharge, r.new.surcharge],
          ['Cess', r.old.cess, r.new.cess],
          ['Total tax', r.old.totalTax, r.new.totalTax],
          ['TDS / TCS', input.tdsTcs, input.tdsTcs],
          ...r.advance.instalments.map((i) => [`${i.label}: ${i.cumulativePct}% (shortfall ${i.shortfall})`, '', i.interest]),
          ['Interest u/s 234C', '', r.advance.interest234C],
          ['Interest u/s 234B', '', r.advance.interest234B],
          ['Balance payable (chosen regime)', '', r.advance.balancePayable],
        ]}
        watermark={best.totalTax ? '' : 'NIL TAX'}
      />,
      pageSpec(biz.print, 'A4'),
    );
  };

  return (
    <div>
      <PageHeader
        title="Income tax helper"
        subtitle="Old vs new regime, presumptive income, advance tax and interest u/s 234B / 234C"
        actions={
          <>
            <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setInput(emptyItrInput(input.fy))}>
              Reset
            </Button>
            <Button icon={<Printer className="h-4 w-4" />} onClick={print}>
              Print
            </Button>
          </>
        }
      />
      <Alert tone="blue">
        For planning only. Section numbers follow the Income-tax Act, 1961; from tax year 2026-27 the Income-tax Act, 2025 renumbers them with the same slabs and limits used here. File on incometax.gov.in and confirm with a tax professional.
      </Alert>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="You" bodyClassName="grid gap-3 p-4 sm:grid-cols-3">
            <Field label="Financial year">
              <Select<SupportedFy>
                value={input.fy}
                onValue={(fy) => set({ fy, filingDate: defaultFilingDate(fy, input.businessMode) })}
                options={SUPPORTED_FYS.map((f) => ({ value: f, label: `FY ${f}` }))}
              />
            </Field>
            <Field label="Age">
              <Select<AgeGroup>
                value={input.age}
                onValue={(age) => set({ age })}
                options={[
                  { value: 'BELOW_60', label: 'Below 60' },
                  { value: 'SENIOR', label: '60 to 79' },
                  { value: 'SUPER_SENIOR', label: '80 or more' },
                ]}
              />
            </Field>
            <Field label="Return filing date (for 234B)">
              <Input type="date" value={input.filingDate} onChange={(e) => set({ filingDate: e.target.value })} />
            </Field>
          </Card>
          <Card title="Income" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
            <Num label="Gross salary / pension" value={input.salary} onValue={(n) => set({ salary: n })} hint="Standard deduction is applied automatically" />
            <Field label="Business / profession">
              <Select<BusinessMode>
                value={input.businessMode}
                onValue={(businessMode) =>
                  set({
                    businessMode,
                    filingDate:
                      input.filingDate === defaultFilingDate(input.fy, input.businessMode)
                        ? defaultFilingDate(input.fy, businessMode)
                        : input.filingDate,
                  })
                }
                options={[
                  { value: 'NONE', label: 'None' },
                  { value: 'ACTUAL', label: 'Profit as per books' },
                  { value: '44AD', label: newAct ? 'Presumptive: business (44AD / s.58)' : 'Presumptive: business (44AD)' },
                  { value: '44ADA', label: newAct ? 'Presumptive: profession (44ADA / s.58)' : 'Presumptive: profession (44ADA)' },
                  { value: '44AE', label: newAct ? 'Presumptive: goods vehicles (44AE / s.58)' : 'Presumptive: goods vehicles (44AE)' },
                ]}
              />
            </Field>
            {input.businessMode === 'ACTUAL' && (
              <>
                <Num label="Net profit" value={input.businessProfit} onValue={(n) => set({ businessProfit: n })} />
                <div className="self-end">
                  <Button size="sm" onClick={fromBooks}>
                    Use profit from my books
                  </Button>
                </div>
              </>
            )}
            {input.businessMode === '44AD' && (
              <>
                <Num label="Turnover received by bank / UPI / cheque" value={input.turnoverDigital} onValue={(n) => set({ turnoverDigital: n })} hint="6% deemed profit" />
                <Num label="Turnover received in cash" value={input.turnoverCash} onValue={(n) => set({ turnoverCash: n })} hint="8% deemed profit" />
              </>
            )}
            {input.businessMode === '44ADA' && (
              <>
                <Num label="Gross receipts" value={input.grossReceipts} onValue={(n) => set({ grossReceipts: n })} hint="50% deemed profit" />
                <Num label="Of which received in cash" value={input.receiptsCash} onValue={(n) => set({ receiptsCash: n })} />
              </>
            )}
            {input.businessMode === '44AE' && (
              <div className="space-y-2 sm:col-span-2">
                {input.vehicles.map((v, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <Field label="Vehicle">
                      <Select
                        value={v.kind}
                        onValue={(kind) => set({ vehicles: input.vehicles.map((x, j) => (j === i ? { ...x, kind } : x)) })}
                        options={[
                          { value: 'HEAVY', label: 'Heavy goods vehicle (> 12 t)' },
                          { value: 'OTHER', label: 'Other goods carriage' },
                        ]}
                      />
                    </Field>
                    {v.kind === 'HEAVY' && (
                      <Field label="Gross weight (t)">
                        <NumberInput className="w-24" value={v.tons} onValue={(n) => set({ vehicles: input.vehicles.map((x, j) => (j === i ? { ...x, tons: n } : x)) })} />
                      </Field>
                    )}
                    <Field label="Months owned">
                      <NumberInput className="w-20" value={v.months} onValue={(n) => set({ vehicles: input.vehicles.map((x, j) => (j === i ? { ...x, months: Math.min(12, Math.max(0, n)) } : x)) })} />
                    </Field>
                    <Button size="sm" variant="ghost" aria-label="Remove vehicle" onClick={() => set({ vehicles: input.vehicles.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))}
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set({ vehicles: [...input.vehicles, { kind: 'OTHER', tons: 0, months: 12 }] })}>
                  Add vehicle
                </Button>
              </div>
            )}
            {['44AD', '44ADA', '44AE'].includes(input.businessMode) && (
              <Num label="Profit you declare (if higher than the minimum)" value={input.declaredProfit} onValue={(n) => set({ declaredProfit: n })} />
            )}
            <Num label="House property (net, loss as negative)" value={input.houseProperty} onValue={(n) => set({ houseProperty: n })} />
            <Num label="Savings bank interest" value={input.interestSavings} onValue={(n) => set({ interestSavings: n })} />
            <Num label="FD / deposit interest" value={input.interestDeposits} onValue={(n) => set({ interestDeposits: n })} />
            <Num label="Other income" value={input.otherIncome} onValue={(n) => set({ otherIncome: n })} />
          </Card>
          <Card title="Deductions (old regime only)" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
            <Num
              label={newAct ? '80C / Schedule XV (s.123): PF, PPF, ELSS, LIC, tuition' : '80C: PF, PPF, ELSS, LIC, tuition'}
              value={input.deductions.sec80C}
              onValue={(n) => setD({ sec80C: n })}
              hint="Up to Rs 1,50,000"
            />
            <Num label="80CCD(1B): NPS" value={input.deductions.sec80CCD1B} onValue={(n) => setD({ sec80CCD1B: n })} hint="Up to Rs 50,000" />
            <Num label="80D: health insurance (self & family)" value={input.deductions.sec80DSelf} onValue={(n) => setD({ sec80DSelf: n })} hint="Rs 25,000 (Rs 50,000 if senior)" />
            <Num label="80D: parents" value={input.deductions.sec80DParents} onValue={(n) => setD({ sec80DParents: n })} />
            <Checkbox className="self-end" checked={input.deductions.parentsSenior} onValue={(v) => setD({ parentsSenior: v })} label="Parents are senior citizens" />
            <Num label="80G: donations (qualifying amount)" value={input.deductions.sec80G} onValue={(n) => setD({ sec80G: n })} />
            <Num label="Other deductions" value={input.deductions.other} onValue={(n) => setD({ other: n })} />
          </Card>
          <Card title="Taxes already paid" bodyClassName="grid gap-3 p-4 sm:grid-cols-2">
            <Num label={newAct ? 'TDS / TCS (Form 168 / Form 26AS / AIS)' : 'TDS / TCS (Form 26AS / AIS)'} value={input.tdsTcs} onValue={(n) => set({ tdsTcs: n })} />
            <div />
            <Num label="Advance tax paid by 15 June" value={input.advancePaid.jun} onValue={(n) => set({ advancePaid: { ...input.advancePaid, jun: n } })} />
            <Num label="Paid 16 June - 15 September" value={input.advancePaid.sep} onValue={(n) => set({ advancePaid: { ...input.advancePaid, sep: n } })} />
            <Num label="Paid 16 September - 15 December" value={input.advancePaid.dec} onValue={(n) => set({ advancePaid: { ...input.advancePaid, dec: n } })} />
            <Num label="Paid 16 December - 15 March" value={input.advancePaid.mar} onValue={(n) => set({ advancePaid: { ...input.advancePaid, mar: n } })} />
          </Card>
        </div>
        <div className="space-y-4">
          {!hasIncome ? (
            <div className="card flex items-center justify-between border-l-4 border-l-slate-300 px-4 py-3">
              <div>
                <p className="text-sm text-slate-500">Regime comparison</p>
                <p className="text-xl font-semibold text-slate-700">Enter your income to compare</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">Difference</p>
                <p className="text-xl font-semibold text-slate-600">{money(0)}</p>
              </div>
            </div>
          ) : !regimesDiffer ? (
            <div className="card flex items-center justify-between border-l-4 border-l-slate-300 px-4 py-3">
              <div>
                <p className="text-sm text-slate-500">Regime comparison</p>
                <p className="text-xl font-semibold text-slate-700">Same tax in both regimes</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">You save</p>
                <p className="text-xl font-semibold text-slate-600">{money(0)}</p>
              </div>
            </div>
          ) : (
            <div className="card flex items-center justify-between border-l-4 border-l-emerald-500 px-4 py-3">
              <div>
                <p className="text-sm text-slate-500">Better for you</p>
                <p className="text-xl font-semibold">{r.better === 'NEW' ? 'New regime' : 'Old regime'}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-500">You save</p>
                <p className="text-xl font-semibold text-emerald-700">{money(r.saving)}</p>
              </div>
            </div>
          )}
          {r.presumptive && (
            <Alert tone={r.presumptive.eligible ? 'green' : 'red'} title={`Section ${r.presumptive.section}: deemed income ${money(r.presumptive.income)}`}>
              {r.presumptive.note}
            </Alert>
          )}
          {r.warnings.length > 0 && (
            <Alert tone="amber">
              <ul className="list-disc pl-5">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <RegimeCard r={r.new} best={regimesDiffer && r.better === 'NEW'} fy={input.fy} money={money} />
            <RegimeCard r={r.old} best={regimesDiffer && r.better === 'OLD'} fy={input.fy} money={money} />
          </div>
          <Card title={`Advance tax & interest (${r.advance.regime === 'NEW' ? 'new' : 'old'} regime)`}>
            {!r.advance.applicable ? (
              <p className="text-sm text-slate-600">{r.advance.reason}</p>
            ) : (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Due</th>
                      <th className="num">Required</th>
                      <th className="num">Paid by then</th>
                      <th className="num">Shortfall</th>
                      <th className="num">{newAct ? '234C (s.425)' : '234C'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.advance.instalments.map((i) => (
                      <tr key={i.due}>
                        <td>
                          {fdate(i.due)} <span className="text-xs text-slate-500">({i.cumulativePct}%)</span>
                        </td>
                        <td className="num">{money(i.required)}</td>
                        <td className="num">{money(i.paidCumulative)}</td>
                        <td className="num">{money(i.shortfall)}</td>
                        <td className="num">{money(i.interest)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Tax after TDS/TCS</span>
                    <span className="tabular-nums">{money(r.advance.taxDue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{newAct ? 'Interest u/s 234C / s.425 (deferment)' : 'Interest u/s 234C (deferment)'}</span>
                    <span className="tabular-nums">{money(r.advance.interest234C)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Interest u/s 234B (default, {r.advance.months234B} month(s))</span>
                    <span className="tabular-nums">{money(r.advance.interest234B)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>Self-assessment tax still payable</span>
                    <span className="tabular-nums">{money(r.advance.balancePayable)}</span>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
