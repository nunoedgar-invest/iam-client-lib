import { IDIDDocument } from "@ew-did-registry/did-resolver-interface";
import { IClaimIssuance, IClaimRejection, IClaimRequest } from "../iam";
import {
  Claim,
  IApp,
  IAppDefinition,
  IOrganization,
  IOrganizationDefinition,
  IRole,
  IRoleDefinition
} from "./cacheServerClient.types";

export interface ICacheServerClient {
  login: (claim: string) => Promise<void>;
  getRoleDefinition: ({ namespace }: { namespace: string }) => Promise<IRoleDefinition>;
  getOrgDefinition: ({ namespace }: { namespace: string }) => Promise<IOrganizationDefinition>;
  getAppDefinition: ({ namespace }: { namespace: string }) => Promise<IAppDefinition>;
  getApplicationRoles: ({ namespace }: { namespace: string }) => Promise<IRole[]>;
  getOrganizationRoles: ({ namespace }: { namespace: string }) => Promise<IRole[]>;
  getOrganizationsByOwner: ({
    owner,
    excludeSubOrgs
  }: {
    owner: string;
    excludeSubOrgs: boolean;
  }) => Promise<IOrganization[]>;
  getApplicationsByOwner: ({ owner }: { owner: string }) => Promise<IApp[]>;
  getApplicationsByOrganization: ({ namespace }: { namespace: string }) => Promise<IApp[]>;
  getSubOrganizationsByOrganization: ({
    namespace
  }: {
    namespace: string;
  }) => Promise<IOrganization[]>;
  getOrgHierarchy: ({ namespace }: { namespace: string }) => Promise<IOrganization>;
  getNamespaceBySearchPhrase: ({
    types,
    search
  }: {
    types?: ("App" | "Org" | "Role")[];
    search: string;
  }) => Promise<IOrganization[] | IApp[] | IRole[]>;
  getRolesByOwner: ({ owner }: { owner: string }) => Promise<IRole[]>;
  getIssuedClaims: ({
    did,
    isAccepted,
    parentNamespace
  }: {
    did: string;
    isAccepted?: boolean;
    parentNamespace?: string;
  }) => Promise<Claim[]>;
  getRequestedClaims: ({
    did,
    isAccepted,
    parentNamespace
  }: {
    did: string;
    isAccepted?: boolean;
    parentNamespace?: string;
  }) => Promise<Claim[]>;
  requestClaim: ({ message, did }: { message: IClaimRequest; did: string }) => Promise<void>;
  issueClaim: ({ message, did }: { message: IClaimIssuance; did: string }) => Promise<void>;
  rejectClaim: ({ message, did }: { message: IClaimRejection; did: string }) => Promise<void>;
  deleteClaim: ({ claimId }: { claimId: string }) => Promise<void>;
  getDIDsForRole: ({ namespace }: { namespace: string }) => Promise<string[]>;
  getDidDocument: ({
    did,
    includeClaims
  }: {
    did: string;
    includeClaims?: boolean;
  }) => Promise<IDIDDocument>;
  addDIDToWatchList: ({ did }: { did: string }) => Promise<void>;
}