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

import { providers, Signer } from "ethers";
import {
  DIDAttribute,
  IDIDDocument,
  IServiceEndpoint,
  IUpdateData,
  PubKeyType
} from "@ew-did-registry/did-resolver-interface";
import { hashes, IProofData, ISaltedFields } from "@ew-did-registry/claims";
import { namehash } from "./utils/ENS_hash";
import { v4 as uuid } from "uuid";
import { IAMBase, emptyAddress } from "./iam/iam-base";
import {
  ENSTypeNotSupportedError,
  CacheClientNotProvidedError,
  MethodNotAvailableInNodeEnvError,
  NATSConnectionNotEstablishedError,
  ENSResolverNotInitializedError,
  ENSRegistryNotInitializedError,
  ChangeOwnershipNotPossibleError,
  DeletingNamespaceNotPossibleError
} from "./errors";
import {
  IAppDefinition,
  IOrganizationDefinition,
  IRoleDefinition
} from "./cacheServerClient/cacheServerClient.types";
import detectEthereumProvider from "@metamask/detect-provider";

type InitializeData = {
  did: string | undefined;
  connected: boolean;
  userClosedModal: boolean;
  didDocument: IDIDDocument | null;
};

export interface IMessage {
  id: string;
  requester: string;
  claimIssuer: string[];
}

export interface IClaimRequest extends IMessage {
  token: string;
}

export interface IClaimIssuance extends IMessage {
  issuedToken: string;
  acceptedBy: string;
}

export interface IClaimRejection extends IMessage {
  isRejected: boolean;
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
  static async isMetamaskExtensionPresent() {
    const provider = await detectEthereumProvider({ mustBeMetaMask: true });
    return !!provider;
  }
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
  async initializeConnection(
    {
      useMetamaskExtension,
      reinitializeMetamask
    }: { useMetamaskExtension: boolean; reinitializeMetamask?: boolean } = {
      useMetamaskExtension: false
    }
  ): Promise<InitializeData> {
    try {
      await this.init({
        useMetamask: useMetamaskExtension,
        initializeMetamask: reinitializeMetamask
      });
    } catch (err) {
      if (err.message === "User closed modal") {
        return {
          did: undefined,
          connected: false,
          userClosedModal: true,
          didDocument: null
        };
      }
      throw new Error(err);
    }
    const didDocument = await this.getDidDocument();

    if (!this._runningInBrowser) {
      return {
        did: this.getDid(),
        connected: true,
        userClosedModal: false,
        didDocument
      };
    }

    return {
      did: this.getDid(),
      connected: this.isConnected() || false,
      userClosedModal: false,
      didDocument
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
    if (this._address) {
      return true;
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
    did = this._did,
    includeClaims = true
  }: { did?: string; includeClaims?: boolean } | undefined = {}): Promise<IDIDDocument | null> {
    if (this._cacheClient && did) {
      try {
        const didDoc = await this._cacheClient.getDidDocument({ did, includeClaims });
        return didDoc;
      } catch (err) {
        if (err.message === "Request failed with status code 404") {
          this._cacheClient.addDIDToWatchList({ did });
          if (this._resolver) {
            const document = await this._resolver.read(did);
            if (includeClaims) {
              const services = await this.downloadClaims({
                services: document.service && document.service.length > 0 ? document.service : []
              });
              document.service = (services as unknown) as IServiceEndpoint[];
            }
            return document;
          }
        }
        throw err;
      }
    }
    if (did && this._resolver) {
      const document = await this._resolver.read(did);
      if (includeClaims) {
        const services = await this.downloadClaims({
          services: document.service && document.service.length > 0 ? document.service : []
        });
        document.service = (services as unknown) as IServiceEndpoint[];
      }
      return document;
    }
    return null;
  }

  /**
   * @param options Options to connect with blockchain
   *
   * @param options.didAttribute Type of document to be updated
   *
   * @param options.data New attribute value
   * @param options.validity Time (s) for the attribute to expire
   *
   * @description updates did document based on data provided
   * @returns true if document is updated successfuly
   *
   */
  async updateDidDocument(options: {
    didAttribute: DIDAttribute;
    data: IUpdateData;
    validity?: number;
  }): Promise<boolean> {
    const { didAttribute, data, validity } = options;
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
  async createPublicClaim({ data, subject }: { data: Record<string, unknown>; subject?: string }) {
    if (this._userClaims) {
      if (subject) {
        return this._userClaims.createPublicClaim(data, { subject, issuer: "" });
      }
      return this._userClaims.createPublicClaim(data);
    }
    throw new Error("User claims not initialized");
  }

  /**
   * publishPublicClaim
   *
   * @description store claim data in ipfs and save url to DID document services
   * @returns ulr to ipfs
   *
   */
  async publishPublicClaim({ token }: { token: string }) {
    if (this._userClaims) {
      const claim = (await this.decodeJWTToken({ token })) as { iss: string };
      const issuer = claim.iss;
      if (!(await this._userClaims.verifySignature(token, issuer))) {
        throw new Error("Incorrect signature");
      }
      const url = await this._ipfsStore.save(token);
      await this.updateDidDocument({
        didAttribute: DIDAttribute.ServicePoint,
        data: {
          type: PubKeyType.VerificationKey2018,
          value: { id: uuid(), serviceEndpoint: url, hash: hashes.SHA256(token), hashAlg: "SHA256" }
        }
      });
      return url;
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
    const { service } = (await this.getDidDocument({ did })) || {};
    return service;
  }

  async decodeJWTToken({ token }: { token: string }) {
    if (!this._jwt) {
      throw new Error("JWT was not initialized");
    }
    return this._jwt.decode(token);
  }

  async createIdentityProof() {
    if (this._provider) {
      const blockNumber = await this._provider.getBlockNumber();
      return this.createPublicClaim({
        data: {
          blockNumber
        }
      });
    }
    throw new Error("Provider not initialized");
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
        this._transactionOverrides
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
   * changeOrgOwnership
   *
   * @description change owner ship of org subdomain and all org owned roles subdomains
   * @returns return array of steps needed to change ownership
   *
   */
  async changeOrgOwnership({
    namespace,
    newOwner,
    returnSteps = false
  }: {
    namespace: string;
    newOwner: string;
    returnSteps?: boolean;
  }) {
    const notOwnedNamespaces = await this.validateOwnership({
      namespace,
      type: ENSNamespaceTypes.Organization
    });
    if (notOwnedNamespaces.length > 0) {
      throw new ChangeOwnershipNotPossibleError({ namespace, notOwnedNamespaces });
    }

    const apps = this._cacheClient
      ? await this.getAppsByOrgNamespace({ namespace })
      : await this.getSubdomains({
          domain: `${ENSNamespaceTypes.Application}.${namespace}`
        });
    if (apps && apps.length > 0) {
      throw new Error("You are not able to change ownership of organization with registered apps");
    }

    const [label, ...rest] = namespace.split(".");
    const steps: { next: () => Promise<void>; info: string }[] = [
      {
        next: () => this.changeSubdomainOwner({ newOwner, namespace: rest.join("."), label }),
        info: `Changing ownership of ${namespace}`
      },
      {
        next: () =>
          this.changeSubdomainOwner({ newOwner, namespace, label: ENSNamespaceTypes.Application }),
        info: `Changing ownership of ${ENSNamespaceTypes.Application}.${namespace}`
      },
      {
        next: () =>
          this.changeSubdomainOwner({ newOwner, namespace, label: ENSNamespaceTypes.Roles }),
        info: `Changing ownership of ${ENSNamespaceTypes.Roles}.${namespace}`
      }
    ];
    const roles =
      (await this.getSubdomains({ domain: `${ENSNamespaceTypes.Roles}.${namespace}` })) || [];
    for (const role of roles) {
      steps.push({
        next: () =>
          this.changeSubdomainOwner({
            label: role,
            namespace: `${ENSNamespaceTypes.Roles}.${namespace}`,
            newOwner
          }),
        info: `Changing ownership of ${role}.${ENSNamespaceTypes.Roles}.${namespace}`
      });
    }
    const reversedSteps = steps.reverse();
    if (returnSteps) {
      return reversedSteps;
    }
    for (const { info, next } of reversedSteps) {
      console.log(info);
      await next();
    }
    return [];
  }

  /**
   * changeAppOwnership
   *
   * @description change owner ship of app subdomain and all app owned subdomains
   * @returns return array of steps needed to change ownership
   *
   */
  async changeAppOwnership({
    namespace,
    newOwner,
    returnSteps
  }: {
    namespace: string;
    newOwner: string;
    returnSteps?: boolean;
  }) {
    const notOwnedNamespaces = await this.validateOwnership({
      namespace,
      type: ENSNamespaceTypes.Application
    });
    if (notOwnedNamespaces.length > 0) {
      throw new ChangeOwnershipNotPossibleError({ namespace, notOwnedNamespaces });
    }
    const [label, ...rest] = namespace.split(".");
    const steps: { next: () => Promise<void>; info: string }[] = [
      {
        next: () => this.changeSubdomainOwner({ newOwner, namespace: rest.join("."), label }),
        info: `Changing ownership of ${namespace}`
      },
      {
        next: () =>
          this.changeSubdomainOwner({ newOwner, namespace, label: ENSNamespaceTypes.Roles }),
        info: `Changing ownership of ${ENSNamespaceTypes.Roles}.${namespace}`
      }
    ];
    const roles =
      (await this.getSubdomains({ domain: `${ENSNamespaceTypes.Roles}.${namespace}` })) || [];
    for (const role of roles) {
      steps.push({
        next: () =>
          this.changeSubdomainOwner({
            label: role,
            namespace: `${ENSNamespaceTypes.Roles}.${namespace}`,
            newOwner
          }),
        info: `Changing ownership of ${role}.${ENSNamespaceTypes.Roles}.${namespace}`
      });
    }
    const reversedSteps = steps.reverse();
    if (returnSteps) {
      return reversedSteps;
    }
    for (const { info, next } of reversedSteps) {
      console.log(info);
      await next();
    }
    return [];
  }

  /**
   * changeRoleOwnership
   *
   * @description change owner ship of role subdomain
   *
   */
  async changeRoleOwnership({ namespace, newOwner }: { namespace: string; newOwner: string }) {
    const notOwnedNamespaces = await this.validateOwnership({
      namespace,
      type: ENSNamespaceTypes.Roles
    });
    if (notOwnedNamespaces.length > 0) {
      throw new ChangeOwnershipNotPossibleError({ namespace, notOwnedNamespaces });
    }
    const [label, ...rest] = namespace.split(".");
    await this.changeSubdomainOwner({ label, namespace: rest.join("."), newOwner });
  }

  /**
   * deleteOrganization
   *
   * @description delete organization and roles
   *
   */
  async deleteOrganization({
    namespace,
    returnSteps
  }: {
    namespace: string;
    returnSteps?: boolean;
  }) {
    const notOwnedNamespaces = await this.validateOwnership({
      namespace,
      type: ENSNamespaceTypes.Organization
    });
    if (notOwnedNamespaces.length > 0) {
      throw new DeletingNamespaceNotPossibleError({ namespace, notOwnedNamespaces });
    }

    const apps = this._cacheClient
      ? await this.getAppsByOrgNamespace({ namespace })
      : await this.getSubdomains({
          domain: `${ENSNamespaceTypes.Application}.${namespace}`
        });
    if (apps && apps.length > 0) {
      throw new Error("You are not able to remove organization with registered apps");
    }
    const steps: { next: () => Promise<void>; info: string }[] = [
      {
        next: () => this.deleteSubdomain({ namespace }),
        info: `Deleting ${namespace}`
      },
      {
        next: () =>
          this.deleteSubdomain({ namespace: `${ENSNamespaceTypes.Application}.${namespace}` }),
        info: `Deleting ${ENSNamespaceTypes.Application}.${namespace}`
      },
      {
        next: () => this.deleteSubdomain({ namespace: `${ENSNamespaceTypes.Roles}.${namespace}` }),
        info: `Deleting ${ENSNamespaceTypes.Roles}.${namespace}`
      }
    ];
    const roles =
      (await this.getSubdomains({ domain: `${ENSNamespaceTypes.Roles}.${namespace}` })) || [];
    for (const role of roles) {
      steps.push({
        next: () =>
          this.deleteSubdomain({
            namespace: `${role}.${ENSNamespaceTypes.Roles}.${namespace}`
          }),
        info: `Deleting ${role}.${ENSNamespaceTypes.Roles}.${namespace}`
      });
    }
    const reversedSteps = steps.reverse();
    if (returnSteps) {
      return reversedSteps;
    }
    for (const { info, next } of reversedSteps) {
      console.log(info);
      await next();
    }
    return [];
  }

  /**
   * deleteApplication
   *
   * @description delete application and roles
   *
   */
  async deleteApplication({
    namespace,
    returnSteps
  }: {
    namespace: string;
    returnSteps?: boolean;
  }) {
    const notOwnedNamespaces = await this.validateOwnership({
      namespace,
      type: ENSNamespaceTypes.Application
    });
    if (notOwnedNamespaces.length > 0) {
      throw new DeletingNamespaceNotPossibleError({ namespace, notOwnedNamespaces });
    }
    const steps: { next: () => Promise<void>; info: string }[] = [
      {
        next: () => this.deleteSubdomain({ namespace }),
        info: `Deleting ${namespace}`
      },
      {
        next: () => this.deleteSubdomain({ namespace: `${ENSNamespaceTypes.Roles}.${namespace}` }),
        info: `Deleting ${ENSNamespaceTypes.Roles}.${namespace}`
      }
    ];
    const roles =
      (await this.getSubdomains({ domain: `${ENSNamespaceTypes.Roles}.${namespace}` })) || [];
    for (const role of roles) {
      steps.push({
        next: () =>
          this.deleteSubdomain({
            namespace: `${role}.${ENSNamespaceTypes.Roles}.${namespace}`
          }),
        info: `Deleting ${role}.${ENSNamespaceTypes.Roles}.${namespace}`
      });
    }
    const reversedSteps = steps.reverse();
    if (returnSteps) {
      return reversedSteps;
    }
    for (const { info, next } of reversedSteps) {
      console.log(info);
      await next();
    }
    return [];
  }

  /**
   * deleteRole
   *
   * @description delete role
   *
   */
  async deleteRole({ namespace }: { namespace: string }) {
    const notOwnedNamespaces = await this.validateOwnership({
      namespace,
      type: ENSNamespaceTypes.Roles
    });
    if (notOwnedNamespaces.length > 0) {
      throw new DeletingNamespaceNotPossibleError({ namespace, notOwnedNamespaces });
    }
    await this.deleteSubdomain({ namespace });
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
   * getENSTypesBySearchPhrase
   */
  getENSTypesBySearchPhrase({ type, search }: { type: ENSNamespaceTypes; search: string }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    if (type === ENSNamespaceTypes.Organization) {
      return this._cacheClient.getOrganizationsBySearchPhrase({ search });
    }
    if (type === ENSNamespaceTypes.Application) {
      return this._cacheClient.getApplicationsBySearchPhrase({ search });
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
   * getRoleDIDs
   *
   * @description get all users did which have certain role
   * @returns array of did's
   *
   */
  getRoleDIDs({ namespace }: { namespace: string }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    return this._cacheClient.getDIDsForRole({ namespace });
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
      const [exists, isOwned] = await Promise.all([
        this._ensRegistry.recordExists(domainHash),
        (async () => {
          const owner = await this._ensRegistry?.owner(domainHash);
          return owner !== emptyAddress;
        })()
      ]);
      return exists && isOwned;
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

  /**
   * validateOwnership
   *
   * @description check ownership of the domain and subdomains of org, app or role
   * @returns true or false whatever the passed is user is a owner of org, app or role
   *
   */
  async validateOwnership({ namespace, type }: { namespace: string; type: ENSNamespaceTypes }) {
    if (this._address) {
      if (type === ENSNamespaceTypes.Roles) {
        const [, ...parentDomain] = namespace.split(".");
        const owner = await this.getOwner({ namespace: parentDomain.join(".") });
        return owner === this._address ? [] : [parentDomain.join(".")];
      }
      if (type === ENSNamespaceTypes.Application) {
        const [, ...appsNamespace] = namespace.split(".");
        const appRolesNamespace = `${ENSNamespaceTypes.Roles}.${namespace}`;
        const namespaces = [namespace, appsNamespace.join("."), appRolesNamespace];
        const notOwnedNamespaces = await Promise.all(
          namespaces.map(async namespace => {
            const owner = await this.getOwner({ namespace });
            if (owner !== this._address) {
              return namespace;
            }
            return null;
          })
        );
        return (notOwnedNamespaces.filter(Boolean) as any) as string[];
      }
      if (type === ENSNamespaceTypes.Organization) {
        const [, ...iamNamespace] = namespace.split(".");
        const rolesNamespace = `${ENSNamespaceTypes.Roles}.${namespace}`;
        const appsNamespace = `${ENSNamespaceTypes.Application}.${namespace}`;
        const namespaces = [iamNamespace.join("."), rolesNamespace, appsNamespace, namespace];
        const notOwnedNamespaces = await Promise.all(
          namespaces.map(async namespace => {
            const owner = await this.getOwner({ namespace });
            if (owner !== this._address) {
              return namespace;
            }
            return null;
          })
        );
        return (notOwnedNamespaces.filter(Boolean) as any) as string[];
      }
      throw new Error("ENS type not supported");
    }
    throw new Error("User not logged in");
  }

  // NATS

  async createClaimRequest({
    issuer,
    claim
  }: {
    issuer: string[];
    claim: { claimType: string; fields: { key: string; value: string | number }[] };
  }) {
    if (!this._did) {
      throw new Error("User not logged in");
    }
    const token = await this.createPublicClaim({ data: claim, subject: claim.claimType });
    if (!token) {
      throw new Error("Token was not generated");
    }
    const message: IClaimRequest = {
      id: uuid(),
      token,
      claimIssuer: issuer,
      requester: this._did || ""
    };

    if (!this._natsConnection) {
      if (this._cacheClient) {
        return this._cacheClient.requestClaim({ did: this._did, message });
      }
      throw new NATSConnectionNotEstablishedError();
    }

    const data = this._jsonCodec?.encode(message);

    issuer.map(issuerDID => {
      this._natsConnection?.publish(`${issuerDID}.${NATS_EXCHANGE_TOPIC}`, data);
    });
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
    if (!this._did) {
      throw new Error("User not logged in");
    }

    const issuedToken = await this.issuePublicClaim({ token });
    if (!issuedToken) {
      throw new Error("Token was not generated");
    }
    const preparedData: IClaimIssuance = {
      id,
      issuedToken,
      requester: requesterDID,
      claimIssuer: [this._did],
      acceptedBy: this._did
    };

    if (!this._natsConnection) {
      if (this._cacheClient) {
        return this._cacheClient.issueClaim({ did: this._did, message: preparedData });
      }
      throw new NATSConnectionNotEstablishedError();
    }

    const dataToSend = this._jsonCodec?.encode(preparedData);
    this._natsConnection.publish(`${requesterDID}.${NATS_EXCHANGE_TOPIC}`, dataToSend);
  }

  async rejectClaimRequest({ id, requesterDID }: { id: string; requesterDID: string }) {
    if (!this._did) {
      throw new Error("User not logged in");
    }

    const preparedData: IClaimRejection = {
      id,
      requester: requesterDID,
      claimIssuer: [this._did],
      isRejected: true
    };

    if (!this._natsConnection) {
      if (this._cacheClient) {
        return this._cacheClient.rejectClaim({ did: this._did, message: preparedData });
      }
      throw new NATSConnectionNotEstablishedError();
    }

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

  // CLAIMS

  async getRequestedClaims({
    did,
    isAccepted,
    parentNamespace
  }: {
    did: string;
    isAccepted?: boolean;
    parentNamespace?: string;
  }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    return this._cacheClient.getRequestedClaims({ did, isAccepted, parentNamespace });
  }

  async getIssuedClaims({
    did,
    isAccepted,
    parentNamespace
  }: {
    did: string;
    isAccepted?: boolean;
    parentNamespace?: string;
  }) {
    if (!this._cacheClient) {
      throw new CacheClientNotProvidedError();
    }
    return this._cacheClient.getIssuedClaims({ did, isAccepted, parentNamespace });
  }
}
