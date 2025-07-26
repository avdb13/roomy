import { AppServiceRegistration as Registration } from "matrix-appservice-bridge";

export const create = (
  url: string,
  domain: string,
  namespace: string,
) => {
  const reg = new Registration(url);

  reg.setId("roomy");
  reg.setProtocols(["roomy"]);

  reg.setHomeserverToken(Registration.generateToken());
  reg.setAppServiceToken(Registration.generateToken());

  reg.setSenderLocalpart(`${namespace}bot`);

  reg.addRegexPattern("users", `@${namespace}.*:${domain}`, true);
  reg.addRegexPattern("aliases", `#${namespace}.*:${domain}`, true);

  return reg;
};