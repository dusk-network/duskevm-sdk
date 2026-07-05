import { sdkError } from "../errors.js";
import type { TransactionHash } from "../types.js";
import { resolveDuskGasPriceLux, type ResolveDuskGasPriceOptions } from "./gas.js";
import type {
  DuskL1Client,
  DuskL1SubmittedTransaction,
  DuskL1TransactionReceipt,
  DuskL1TransactionRequest,
  WaitForDuskTransactionOptions,
} from "./types.js";

export type DuskL1SubmitOptions = Omit<ResolveDuskGasPriceOptions, "client"> & {
  wait?: boolean | WaitForDuskTransactionOptions;
};

export type SubmittedDuskL1Transaction = {
  submitted: DuskL1SubmittedTransaction;
  request: DuskL1TransactionRequest;
  receipt?: DuskL1TransactionReceipt;
};

export async function submitDuskL1Transaction(
  client: DuskL1Client,
  request: DuskL1TransactionRequest,
  options: DuskL1SubmitOptions = {}
): Promise<SubmittedDuskL1Transaction> {
  const withGasPrice = await withResolvedGasPrice(client, request, options);
  const submitted = await client.submitTransaction(withGasPrice);
  const result: SubmittedDuskL1Transaction = {
    submitted,
    request: withGasPrice,
  };

  if (options.wait) {
    result.receipt = await waitForDuskL1Transaction(
      client,
      submitted.transactionHash,
      options.wait === true ? undefined : options.wait
    );
  }

  return result;
}

export async function waitForDuskL1Transaction(
  client: Pick<DuskL1Client, "waitForTransaction">,
  transactionHash: TransactionHash,
  options?: WaitForDuskTransactionOptions
): Promise<DuskL1TransactionReceipt> {
  if (!client.waitForTransaction) {
    throw sdkError("UNSUPPORTED", "The Dusk L1 client does not expose waitForTransaction");
  }

  const receipt = await client.waitForTransaction(transactionHash, options);
  if (receipt.success === false) {
    throw sdkError("TRANSACTION_FAILED", "Dusk L1 transaction failed", receipt);
  }
  if (receipt.success !== true) {
    throw sdkError("CLIENT_ERROR", "Dusk L1 transaction receipt did not confirm success", receipt);
  }
  return receipt;
}

async function withResolvedGasPrice(
  client: DuskL1Client,
  request: DuskL1TransactionRequest,
  options: ResolveDuskGasPriceOptions
): Promise<DuskL1TransactionRequest> {
  if (request.gasPriceLux !== undefined) return request;

  const gasOptions: ResolveDuskGasPriceOptions = { client };
  if (options.deployment !== undefined) gasOptions.deployment = options.deployment;
  if (options.gasPriceLux !== undefined) gasOptions.gasPriceLux = options.gasPriceLux;

  return {
    ...request,
    gasPriceLux: await resolveDuskGasPriceLux(gasOptions),
  };
}
