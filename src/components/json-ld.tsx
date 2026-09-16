import { BRAND } from "@/lib/brand";
import { siteUrl } from "@/lib/seo";

/**
 * schema.org structured data. Kept deliberately minimal: WebSite+SearchAction
 * (sitelinks search box) and Organization. We do NOT emit per-outlet
 * NewsMediaOrganization — ownership/bias data is OUR estimate, not a claim
 * made on the outlets' behalf.
 */
function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Serialized server-side from our own constants — nothing user-supplied.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function SiteJsonLd() {
  const base = siteUrl();
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: BRAND.name,
          url: base,
          description: BRAND.tagline,
          inLanguage: "pt-BR",
          potentialAction: {
            "@type": "SearchAction",
            target: {
              "@type": "EntryPoint",
              urlTemplate: `${base}/buscar?q={search_term_string}`,
            },
            "query-input": "required name=search_term_string",
          },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: BRAND.name,
          url: base,
          logo: `${base}/icons/icon-512.png`,
          email: BRAND.contactEmail,
        }}
      />
    </>
  );
}
