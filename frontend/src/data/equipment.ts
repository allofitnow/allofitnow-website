// Equipment-rental fleet — the draggable marquee on /services.
//
// This SHAPE MIRRORS the Payload `equipment` collection (label, image, tip, order, slug,
// center, placeholder). getEquipment() prefers the CMS and falls back to the local SEED
// below when the collection is empty or unreachable — so the build works whether or not the
// CMS is live/populated yet. The Payload fetch/mapper live in lib/payload.ts (getEquipmentDocs).

export interface Equipment {
  /** Stable id — becomes the Payload doc slug. */
  slug: string;
  /** Display label in the marquee. */
  label: string;
  /** Absolute plate image URL (Payload media). Empty when `placeholder` is true. */
  image: string;
  /** Populated media doc behind `image` (#58) — srcset source; null → plain src. */
  imageDoc?: import('@/lib/media').MediaDoc | null;
  /** Body copy shown under the marquee when this item is centered. */
  tip: string;
  /** Marquee order, left→right (ascending). */
  order: number;
  /** The item centered on the playhead when the section opens. */
  center?: boolean;
  /** No real plate asset yet — the section renders a placeholder plate. */
  placeholder?: boolean;
}

// Real plate images still live on the legacy WordPress media host; the CMS migration
// will re-home them as Payload uploads (absolute URLs, exactly like project media).
const WP = 'https://allofitnow.com/wp-content/uploads/';

const SEED: Equipment[] = [
  {
    slug: 'disguise-gx3', label: 'DISGUISE GX3', image: `${WP}GX3.png`, order: 10,
    tip: 'The flagship server for touring and live events, the disguise gx3 boasts the best-in-class graphics card for real-time content and visual effects.',
  },
  {
    slug: 'x3-server', label: 'X3 SERVER', image: '', placeholder: true, order: 20,
    tip: 'Specs and plate image coming soon.',
  },
  {
    slug: 'silverdraft-a6000', label: 'SILVERDRAFT A6000 RENDER NODES', image: `${WP}SilverDraft.png`, order: 30,
    tip: 'AOIN has a fleet of 10 Silverdraft render engines, racked and ready for Augmented Reality, Ndisplay, or render-farm scenarios.',
  },
  {
    slug: 'custom-rack-builds', label: 'CUSTOM RACK BUILD SOLUTIONS', image: `${WP}CustomRacks.png`, order: 40, center: true,
    tip: 'Prebuilt, custom-configured racks built for plug-and-play project rentals — Music Touring, AR for Broadcast, Ndisplay render nodes, or onsite render farms.',
  },
  {
    slug: 'laptop-flypacks', label: 'LAPTOP FLYPACKS', image: '', placeholder: true, order: 50,
    tip: 'Specs and plate image coming soon.',
  },
  {
    slug: 'vfc-cards', label: 'VFC CARDS', image: `${WP}vfc.png`, order: 60,
    tip: 'We carry VFC cards for every connection type. SDI VFC · HDMI VFC · DISPLAYPORT VFC · DVI VFC.',
  },
  {
    slug: 'renderstream-hardware', label: 'RENDERSTREAM HARDWARE', image: `${WP}Mellanox-SN2010.png`, order: 70,
    tip: 'Networking hardware for high-bandwidth Renderstream and cluster-rendering workflows.',
  },
];

/** The fleet in marquee order (left→right). Prefers the CMS collection; falls back to the seed. */
export async function getEquipment(): Promise<Equipment[]> {
  const { getEquipmentDocs } = await import('@/lib/payload');
  const cms = await getEquipmentDocs();
  const items = cms.length ? cms : SEED;
  return [...items].sort((a, b) => a.order - b.order);
}
