import type { PartyRegistration, SupplyKind } from '../model';
import { stateCodeFromGstin } from './gstin';
import { FOREIGN_POS, isUtgstTerritory } from './states';

export interface SupplyInput {
  businessCountry: string;
  businessState: string;
  placeOfSupply: string;
  partyRegistration: PartyRegistration;
  partyCountry: string;
}

/**
 * Decide which taxes apply.
 * - Business outside India -> NON_GST (one local tax such as VAT).
 * - Foreign party / POS 96 -> EXPORT; SEZ unit -> SEZ (both inter-state, IGST).
 * - Same state -> CGST+SGST, or CGST+UTGST in a UT without legislature.
 * - Different state -> IGST.
 */
export function determineSupplyKind(input: SupplyInput): SupplyKind {
  if (input.businessCountry !== 'IN') return 'NON_GST';
  if (input.partyRegistration === 'OVERSEAS' || input.placeOfSupply === FOREIGN_POS) return 'EXPORT';
  if (input.partyCountry && input.partyCountry !== 'IN') return 'EXPORT';
  if (input.partyRegistration === 'SEZ') return 'SEZ';
  if (!input.placeOfSupply || input.placeOfSupply === input.businessState) {
    return isUtgstTerritory(input.businessState) ? 'INTRA_UT' : 'INTRA_STATE';
  }
  return 'INTER_STATE';
}

export interface PlaceOfSupplySource {
  gstin: string;
  stateCode: string;
  countryCode: string;
  registration: PartyRegistration;
}

/** Default place of supply: party GSTIN state, else address state, else 96 abroad, else our state. */
export function defaultPlaceOfSupply(businessState: string, party: PlaceOfSupplySource | null): string {
  if (!party) return businessState;
  if (party.registration === 'OVERSEAS' || (party.countryCode && party.countryCode !== 'IN')) return FOREIGN_POS;
  const fromGstin = party.gstin ? stateCodeFromGstin(party.gstin) : '';
  return fromGstin || party.stateCode || businessState;
}

export function isInterState(kind: SupplyKind): boolean {
  return kind === 'INTER_STATE' || kind === 'EXPORT' || kind === 'SEZ';
}

/** Human description shown in the invoice editor. */
export function supplyKindLabel(kind: SupplyKind, exportWithTax = true): string {
  switch (kind) {
    case 'INTRA_STATE':
      return 'Intra-state: CGST + SGST';
    case 'INTRA_UT':
      return 'Intra-UT: CGST + UTGST';
    case 'INTER_STATE':
      return 'Inter-state: IGST';
    case 'EXPORT':
      return exportWithTax ? 'Export with payment of IGST' : 'Export under LUT/bond (zero-rated)';
    case 'SEZ':
      return exportWithTax ? 'SEZ supply with payment of IGST' : 'SEZ supply under LUT (zero-rated)';
    case 'NON_GST':
      return 'Outside India: local tax';
  }
}
