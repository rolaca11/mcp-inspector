import { getCACertificates, setDefaultCACertificates } from "node:tls";

setDefaultCACertificates([
  ...getCACertificates("default"),
  ...getCACertificates("system"),
]);
