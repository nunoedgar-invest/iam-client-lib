// Copyright 2020 Energy Web Foundation
// This file is part of IAM Client Library brought to you by the Energy Web Foundation,
// a global non-profit organization focused on accelerating blockchain technology across the energy sector,
// incorporated in Zug, Switzerland.
//
// The IAM Client Library is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY and without an implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details, at <http://www.gnu.org/licenses/>.
//
// @authors: Kim Honoridez
// @authors: Daniel Wojno

import { providers, Signer, utils } from "ethers";
import {
  DIDAttribute,
  IDIDDocument,
  IServiceEndpoint,
  IUpdateData
} from "@ew-did-registry/did-resolver-interface";
import { IProofData, ISaltedFields } from "@ew-did-registry/claims";
import { namehash } from "./utils/ENS_hash";
import { v4 as uuid } from "uuid";
import { IAMBase } from "./iam/iam-base";
import {
  ENSTypeNotSupportedError,
  CacheClientNotProvidedError,
  MethodNotAvailableInNodeEnvError,
  NATSConnectionNotEstablishedError,
  ENSResolverNotInitializedError,
  ENSRegistryNotInitializedError
} from "./errors";
import {
  IAppDefinition,
  IOrganizationDefinition,
  IRoleDefinition
} from "./cacheServerClient/cacheServerClient.types";

const { hexlify } = utils;

type InitializeData = {
  did: string | undefined;
  connected: boolean;
  userClosedModal: boolean;
};

interface IMessage {
  id: string;
  token: string;
  issuedToken?: string;
  requester: string;
  issuer: string;
}

export enum ENSNamespaceTypes {
  Roles = "roles",
  Application = "apps",
  Organization = "org"
}

export const NATS_EXCHANGE_TOPIC = "claim.exchange";

/**
 * Decentralized Identity and Access Management (IAM) Type
 */
export class IAM extends IAMBase {
  // GETTERS

  /**
   * Get DID
   *
   * @returns did string if connected to wallet, if not returns undefined
   */

  getDid(): string | undefined {
    return this._did;
  }

  /**
   * Get signer
   *
   * @returns JsonRpcSigner if connected to wallet, if not returns undefined
   */

  getSigner(): providers.JsonRpcSigner | Signer | undefined {
    return this._signer;
  }

  // CONNECTION

  /**
   * Initialize connection to wallet
   * @description creates web3 provider and establishes secure connection to selected wallet
   * @summary if not connected to wallet will show connection modal, but if already connected (data stored in localStorage) will only return initial data without showing modal
   * @requires needs to be called before any of other methods
   *
   * @returns did string, status of connection and info if the user closed the wallet selection modal
   */
  async initializeConnection(): Promise<InitializeData> {
    try {
      await this.init();
    } catch (err) {
      if (err.message === "User closed modal") {
        return {
          did: undefined,
          connected: false,
          userClosedModal: true
        };
      }
      throw new Error(err);
    }
    if (!this._runningInBrowser) {
      return {
        did: undefined,
        connected: true,
        userClosedModal: false
      };
    }

    return {
      did: this.getDid(),
      connected: this.isConnected() || false,
      userClosedModal: false
    };
  }

  /**
   * Close connection to wallet
   * @description closes the connection between dApp and the wallet
   *
   */

  async closeConnection() {
    if (this._walletConnectProvider) {
      await this._walletConnectProvider.close();
      this._did = undefined;
      this._address = undefined;
      this._signer = undefined;
    }
  }

  /**
   * isConnected
   *
   * @returns info if the connection is already established
   *
   */
  isConnected(): boolean {
    if (this._walletConnectProvider) {
      return this._walletConnectProvider.connected;
    }
    return false;
  }

  // DID DOCUMENT

  /**
   * getDidDocument
   *
   * @returns whole did document if connected, if not returns null
   *
   */
  async getDidDocument({
    did = this._did
  }: { did?: string } | undefined = {}): Promise<IDIDDocument | null> {
    if (did && this._resolver) {
      const document = await this._resolver.read(did);
      const services = await this.downloadClaims({
        services: document.service && document.service.length > 1 ? document.service : []
      });
      document.service = (services as unknown) as IServiceEndpoint[];
      return document;
    }
    return null;
  }

  /**
   * updateDidDocument
   *
   * @description updates did document based on data provided
   * @returns info if did document was updated
   *
   */
  async updateDidDocument({
    didAttribute,
    data,
    validity
  }: {
    didAttribute: DIDAttribute;
    data: IUpdateData;
    validity?: number;
  }): Promise<boolean> {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("updateDidDocument");
    }
    if (this._document) {
      const updated = await this._document.update(didAttribute, data, validity);
      return updated;
    }
    return false;
  }

  /**
   * revokeDidDocument
   *
   * @description revokes did document
   * @returns information (true/false) if the DID document was revoked
   *
   */
  async revokeDidDocument(): Promise<boolean> {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("revokeDidDocument");
    }
    if (this._document) {
      return this._document.deactivate();
    }
    return false;
  }

  /**
   * createPublicClaim
   *
   * @description create a public claim based on data provided
   * @returns JWT token of created claim
   *
   */
  async createPublicClaim({ data }: { data: Record<string, unknown> }) {
    if (this._userClaims) {
      return this._userClaims.createPublicClaim(data);
    }
    return null;
  }

  /**
   * publishPublicClaim
   *
   * @description store claim data in ipfs and save url to DID document services
   * @returns ulr to ipfs
   *
   */
  async publishPublicClaim({
    token,
    claimData
  }: {
    token: string;
    claimData: Record<string, unknown>;
  }) {
    if (this._userClaims) {
      return this._userClaims.publishPublicClaim(token, claimData);
    }
    return null;
  }

  /**
   * createProofClaim
   *
   * @description creates a proof of a claim
   * @returns proof token
   *
   */
  async createProofClaim({
    claimUrl,
    saltedFields
  }: {
    claimUrl: string;
    saltedFields: ISaltedFields;
  }) {
    if (this._userClaims) {
      const encryptedSaltedFields: IProofData = {};
      let counter = 0;
      Object.entries(saltedFields).forEach(([key, value]) => {
        if (counter % 2 === 0) {
          encryptedSaltedFields[key] = {
            value,
            encrypted: true
          };
        } else {
          encryptedSaltedFields[key] = {
            value,
            encrypted: false
          };
        }
        counter++;
      });
      return this._userClaims?.createProofClaim(claimUrl, encryptedSaltedFields);
    }
    return null;
  }

  /**
   * issuePublicClaim
   *
   * @description issue a public claim
   * @returns return issued token
   *
   */
  async issuePublicClaim({ token }: { token: string }) {
    if (this._issuerClaims) {
      return this._issuerClaims.issuePublicClaim(token);
    }
    return null;
  }

  /**
   * verifyPublicClaim
   *
   * @description verifies issued token of claim
   * @returns public claim data
   *
   */
  async verifyPublicClaim({ issuedToken }: { issuedToken: string }) {
    if (this._verifierClaims) {
      return this._verifierClaims.verifyPublicProof(issuedToken);
    }
    return null;
  }

  /**
   * createSelfSignedClaim
   *
   * @description creates self signed claim and upload the data to ipfs
   *
   */
  async createSelfSignedClaim({ data }: { data: Record<string, unknown> }) {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("createSelfSignedClaim");
    }
    if (this._userClaims) {
      const claim = await this._userClaims.createPublicClaim(data);
      await this._userClaims.publishPublicClaim(claim, data);
    }
  }

  /**
   * getUserClaims
   *
   * @description get user claims
   *
   */
  async getUserClaims({ did = this._did }: { did?: string } | undefined = {}) {
    if (this._resolver && did) {
      const document = await this._resolver.read(did);
      const services = await this.downloadClaims({
        services: document.service && document.service.length > 1 ? document.service : []
      });
      return services;
    }
    return [];
  }

  async decodeJWTToken({ token }: { token: string }) {
    if (!this._jwt) {
      throw new Error("JWT was not initialized");
    }
    return this._jwt.decode(token);
  }

  /// ROLES

  /**
   * setRoleDefinition
   *
   * @description sets role definition in ENS domain
   * @description please use it only when you want to update role definitions for already created role (domain)
   *
   */
  async setRoleDefinition({
    domain,
    data
  }: {
    domain: string;
    data: IAppDefinition | IOrganizationDefinition | IRoleDefinition;
  }) {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("setRoleDefinition");
    }
    if (this._signer && this._ensResolver) {
      const ensResolverWithSigner = this._ensResolver.connect(this._signer);
      const stringifiedData = JSON.stringify(data);
      const namespaceHash = namehash(domain) as string;
      const setTextTx = await ensResolverWithSigner.setText(
        namespaceHash,
        "metadata",
        stringifiedData,
        {
          gasLimit: hexlify(4900000),
          gasPrice: hexlify(0.1)
        }
      );
      await setTextTx.wait();
      console.log(`Added data: ${stringifiedData} to ${domain} metadata`);
    }
  }

  /**
   * createOrganization
   *
   * @description creates organization (create subdomain, sets the domain name and sets the role definition to metadata record in ENS Domain)
   * @description and sets subdomain for roles and app for org namespace
   *
   */
  async createOrganization({
    orgName,
    data,
    namespace,
    returnSteps
  }: {
    orgName: string;
    data: IOrganizationDefinition;
    namespace: string;
    returnSteps?: boolean;
  }) {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("createOrganization");
    }
    const newDomain = `${orgName}.${namespace}`;
    const rolesDomain = `${ENSNamespaceTypes.Roles}.${newDomain}`;
    const appsDomain = `${ENSNamespaceTypes.Application}.${newDomain}`;
    const steps = [
      {
        next: () => this.createSubdomain({ subdomain: orgName, domain: namespace }),
        info: "Create organization subdomain"
      },
      {
        next: () => this.setDomainName({ domain: newDomain }),
        info: "Register reverse name for organization subdomain"
      },
      {
        next: () => this.setRoleDefinition({ data, domain: newDomain }),
        info: "Set definition for organization"
      },
      {
        next: () => this.createSubdomain({ subdomain: ENSNamespaceTypes.Roles, domain: newDomain }),
        info: "Create roles subdomain for organization"
      },
      {
        next: () => this.setDomainName({ domain: rolesDomain }),
        info: "Register reverse name for roles subdomain"
      },
      {
        next: () =>
          this.createSubdomain({ subdomain: ENSNamespaceTypes.Application, domain: newDomain }),
        info: "Create app subdomain for organization"
      },
      {
        next: () => this.setDomainName({ domain: appsDomain }),
        info: "Register reverse name for app subdomain"
      }
    ];
    if (returnSteps) {
      return steps;
    }
    for (const { next } of steps) {
      await next();
    }
    return [];
  }

  /**
   * createApp
   *
   * @description creates role (create subdomain, sets the domain name and sets the role definition to metadata record in ENS Domain)
   * @description creates roles subdomain for the app namespace
   *
   */
  async createApplication({
    appName,
    namespace,
    data,
    returnSteps
  }: {
    appName: string;
    namespace: string;
    data: IAppDefinition;
    returnSteps?: boolean;
  }) {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("createApplication");
    }
    const newDomain = `${appName}.${namespace}`;
    const rolesNamespace = `${ENSNamespaceTypes.Roles}.${newDomain}`;
    const steps = [
      {
        next: () => this.createSubdomain({ subdomain: appName, domain: namespace }),
        info: "Set subdomain for application"
      },
      {
        next: () => this.setDomainName({ domain: newDomain }),
        info: "Set name for application"
      },
      {
        next: () => this.setRoleDefinition({ data, domain: newDomain }),
        info: "Set definition for application"
      },
      {
        next: () => this.createSubdomain({ subdomain: ENSNamespaceTypes.Roles, domain: newDomain }),
        info: "Create roles subdomain for application"
      },
      {
        next: () => this.setDomainName({ domain: rolesNamespace }),
        info: "Set name for roles subdomain for application"
      }
    ];
    if (returnSteps) {
      return steps;
    }
    for (const { next } of steps) {
      await next();
    }
    return [];
  }

  /**
   * createRole
   *
   * @description creates role (create subdomain, sets the domain name and sets the role definition to metadata record in ENS Domain)
   * @returns information (true/false) if the role was created
   *
   */
  async createRole({
    roleName,
    namespace,
    data,
    returnSteps
  }: {
    roleName: string;
    namespace: string;
    data: IRoleDefinition;
    returnSteps?: boolean;
  }) {
    if (!this._runningInBrowser) {
      throw new MethodNotAvailableInNodeEnvError("createRole");
    }
    const newDomain = `${roleName}.${namespace}`;
    const steps = [
      {
        next: () => this.createSubdomain({ subdomain: roleName, domain: namespace }),
        info: "Create subdomain for role"
      },
      {
        next: () => this.setDomainName({ domain: newDomain }),
        info: "Set name for role"
      },
      {
        next: () => this.setRoleDefinition({ data, domain: newDomain }),
        info: "Set role definition for role"
      }
    ];
    if (returnSteps) {
      return steps;
    }
    for (const { next } of steps) {
      await next();
    }
    return [];
  }

  /**
   * getRoleDefinition
   *
   * @description get role definition form ens domain metadata record
   * @returns metadata string or empty string when there is no metadata
   *
   */
  async getDefinition({ type, namespace }: { type: ENSNamespaceTypes; namespace: string }) {
    if (this._cacheClient && type) {
      if (type === ENSNamespaceTypes.Roles) {
        return this._cacheClient.getRoleDefinition({ namespace });
      }
      if (type === ENSNamespaceTypes.Application) {
        return this._cacheClient.getAppDefinition({ namespace });
      }
      if (type === ENSNamespaceTypes.Organization) {
        return this._cacheClient.getOrgDefinition({ namespace });
      }
      throw new ENSTypeNotSupportedError();
    }
    if (this._ensResolver) {
      const roleHash = namehash(namespace);
      const metadata = await this._ensResolver.text(roleHash, "metadata");
      return JSON.parse(metadata) as IRoleDefinition | IAppDefinition | IOrganizationDefinition;
    }
    throw new ENSResolverNotInitializedError();
  }

  /**
   * getRolesByNamespace
   *
   * @description get all subdomains for certain domain
   * @returns array of subdomains or empty array when there is no subdomains
   *
   */
  getRolesByNamespace({
    parentType,
    namespace
  }: {
    parentType: ENSNamespaceTypes.Application | ENSNamespaceTypes.Organization;
    namespace: string;
  }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    if (parentType === ENSNamespaceTypes.Organization) {
      return this._cacheClient.getOrganizationRoles({ namespace });
    }
    if (parentType === ENSNamespaceTypes.Application) {
      return this._cacheClient.getApplicationRoles({ namespace });
    }
    throw new ENSTypeNotSupportedError();
  }

  /**
   * getENSTypesByOwner
   *
   * @description get all subdomains for certain domain
   * @returns array of subdomains or empty array when there is no subdomains
   *
   */
  getENSTypesByOwner({ type, owner }: { type: ENSNamespaceTypes; owner: string }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    if (type === ENSNamespaceTypes.Organization) {
      return this._cacheClient.getOrganizationsByOwner({ owner });
    }
    if (type === ENSNamespaceTypes.Application) {
      return this._cacheClient.getApplicationsByOwner({ owner });
    }
    if (type === ENSNamespaceTypes.Roles) {
      return this._cacheClient.getRolesByOwner({ owner });
    }
    throw new ENSTypeNotSupportedError();
  }

  /**
   * getENSTypesByOwner
   *
   * @description get all applications for organization namespace
   * @returns array of subdomains or empty array when there is no subdomains
   *
   */
  getAppsByOrgNamespace({ namespace }: { namespace: string }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    return this._cacheClient.getApplicationsByOrganization({ namespace });
  }

  /**
   * getSubdomains
   *
   * @description get all subdomains for certain domain
   * @returns array of subdomains or empty array when there is no subdomains
   *
   */
  async getSubdomains({ domain }: { domain: string }) {
    if (this._ensRegistry) {
      const domains = await this.getFilteredDomainsFromEvent({ domain });
      const role = domain.split(".");
      const subdomains: Record<string, null> = {};
      for (const name of domains) {
        const nameArray = name.split(".").reverse();
        if (nameArray.length <= role.length) return;
        subdomains[nameArray[role.length]] = null;
      }
      return Object.keys(subdomains);
    }
    throw new ENSRegistryNotInitializedError();
  }

  /**
   * checkExistenceOfDomain
   *
   * @description check existence of domain in ENS registry
   * @returns true or false whatever the domain is present
   *
   */
  async checkExistenceOfDomain({ domain }: { domain: string }) {
    if (this._ensRegistry) {
      const domainHash = namehash(domain);
      return this._ensRegistry.recordExists(domainHash);
    }
    throw new ENSRegistryNotInitializedError();
  }

  /**
   * isOwner
   *
   * @description check ownership of the domain
   * @default if user is not specified it will check the current logged user
   * @returns true or false whatever the passed is user is a owner of domain
   *
   */
  async isOwner({ domain, user = this._address }: { domain: string; user?: string }) {
    if (this._ensRegistry) {
      const domainHash = namehash(domain);
      const owner = await this._ensRegistry.owner(domainHash);
      return owner === user;
    }
    throw new ENSRegistryNotInitializedError();
  }

  // NATS

  async createClaimRequest({
    issuerDID,
    claim
  }: {
    issuerDID: string;
    claim: Record<string, unknown>;
  }) {
    if (!this._natsConnection) {
      throw new NATSConnectionNotEstablishedError();
    }
    const token = await this.createPublicClaim({ data: claim });
    if (!token) {
      throw new Error("Token was not generated");
    }
    const message: IMessage = {
      id: uuid(),
      token,
      issuer: issuerDID,
      requester: this._did || ""
    };
    const data = this._jsonCodec?.encode(message);
    this._natsConnection.publish(`${issuerDID}.${NATS_EXCHANGE_TOPIC}`, data);
  }

  async issueClaimRequest({
    requesterDID,
    id,
    token
  }: {
    requesterDID: string;
    token: string;
    id: string;
  }) {
    if (!this._natsConnection) {
      throw new NATSConnectionNotEstablishedError();
    }

    const issuedToken = await this.issuePublicClaim({ token });
    if (!issuedToken) {
      throw new Error("Token was not generated");
    }
    const preparedData: IMessage = {
      id,
      issuedToken,
      requester: requesterDID,
      issuer: this._did || "",
      token
    };
    const dataToSend = this._jsonCodec?.encode(preparedData);
    this._natsConnection.publish(`${requesterDID}.${NATS_EXCHANGE_TOPIC}`, dataToSend);
  }

  async subscribeToMessages({
    topic = `${this._did}.${NATS_EXCHANGE_TOPIC}`,
    messageHandler
  }: {
    topic?: string;
    messageHandler: (data: IMessage) => void;
  }) {
    if (!this._natsConnection) {
      throw new NATSConnectionNotEstablishedError();
    }
    const subscription = this._natsConnection.subscribe(topic);
    for await (const msg of subscription) {
      const decodedMessage = this._jsonCodec?.decode(msg.data) as IMessage;
      messageHandler(decodedMessage);
    }
  }
}
