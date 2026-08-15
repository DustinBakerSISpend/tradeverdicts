const readFlag = (name) =>
  /^(?:1|true|yes|on)$/iu.test(
    String(process.env?.[name] ?? "").trim(),
  );

export const ADSENSE_SITE_APPROVED =
  readFlag("ADSENSE_SITE_APPROVED");

export const ADS_SERVING_ENABLED =
  ADSENSE_SITE_APPROVED;
