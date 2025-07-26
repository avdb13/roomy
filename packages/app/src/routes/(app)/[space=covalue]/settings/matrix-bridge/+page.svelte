<script lang="ts">
  import { page } from "$app/state";
  import { env } from "$env/dynamic/public";
  import { Badge, Button } from "@fuxui/base";
  import { onMount } from "svelte";
  import {
    Account,
    grantFullWritePermissions,
    hasFullWritePermissions,
    revokeFullWritePermissions,
    RoomyEntity,
  } from "@roomy-chat/sdk";
  import toast from "svelte-french-toast";
  import { CoState } from "jazz-tools/svelte";

  type BridgeData = {
    matrixSpaceId: string;
    appserviceToken: string;
    bridgeJazzAccount: Account;
    hasFullWritePermissions: boolean;
  };

  type BridgeStatus =
    | { type: "checking" }
    | { type: "pending" }
    | ({ type: "loaded" } & BridgeData)
    | { type: "error_checking" };

  type InfoData = { appserviceToken: string; jazzAccountId: string };

  type GetSpaceData = { id: string };

  let space = $derived(new CoState(RoomyEntity, page.params.space));

  let bridgeStatus: BridgeStatus = $state({
    type: "checking",
  });

  const bridgeUri = env.PUBLIC_MATRIX_BRIDGE ?? "https://localhost:3302";

  async function _fetch<T extends object>(uri: string, message: string) {
    const data: T | { error: string; status: number } = await fetch(uri).then(
      (resp) => resp.json(),
    );

    if ("error" in data) {
      console.error(`${message}: ${JSON.stringify(data, null, 2)}`);

      bridgeStatus =
        data.status === 404 ? { type: "pending" } : { type: "error_checking" };

      return undefined;
    }

    return data;
  }

  async function updateBridgeStatus() {
    if (!space.current) return;

    try {
      const info = await _fetch<InfoData>(
        `${bridgeUri}/info`,
        "Couldn't fetch Matrix appservice token from bridge.",
      );

      if (!info) return;

      const matrixSpace = await _fetch<GetSpaceData>(
        `${bridgeUri}/get-space?id=${page.params.space}`,
        "Couldn't fetch Matrix space ID from bridge.",
      );

      if (!matrixSpace) return;

      const jazzAccount = await Account.load(info.jazzAccountId);

      if (!jazzAccount) {
        console.error("Could not load jazz account for matrix bridge.");

        bridgeStatus = { type: "error_checking" };

        return;
      }

      const hasWrite = await hasFullWritePermissions(
        jazzAccount,
        space.current,
      );

      bridgeStatus = {
        type: matrixSpace ? "loaded" : "pending",
        appserviceToken: info.appserviceToken,
        bridgeJazzAccount: jazzAccount,
        matrixSpaceId: matrixSpace && matrixSpace.id,
        hasFullWritePermissions: hasWrite,
      };
    } catch (_) {}
  }

  async function grantBotPermissions() {
    if (bridgeStatus.type != "loaded" || !space.current) return;
    await grantFullWritePermissions(
      bridgeStatus.bridgeJazzAccount,
      space.current,
    );
    updateBridgeStatus();
    toast.success("Successfully granted bot permissions.");
  }
  async function revokeBotPermissions() {
    if (bridgeStatus.type != "loaded" || !space.current) return;
    await revokeFullWritePermissions(
      bridgeStatus.bridgeJazzAccount,
      space.current,
    );
    updateBridgeStatus();
    toast.success("Revoked granted bot permissions.");
  }

  // Reload app when this module changes to prevent stacking the setIntervals
  if (import.meta.hot) {
    import.meta.hot.accept(() => {
      window.location.reload();
    });
  }
  onMount(() => {
    let interval: undefined | ReturnType<typeof setInterval>;
    const updateStatus = () => {
      // if (document.visibilityState == "visible") {
      console.log("checking Matrix bridge status");
      updateBridgeStatus();
      interval = setInterval(updateStatus, 8000);
      // } else {
      //   if (interval) clearInterval(interval);
      // }
    };
    updateStatus();
    document.addEventListener("visibilitychange", updateStatus);

    return () => {
      document.removeEventListener("visibilitychange", updateStatus);
    };
  });
  $effect(() => {
    space;
    updateBridgeStatus();
  });
</script>

{#snippet bridgeStatusBadge()}
  {#if bridgeStatus.type == "checking"}
    <Badge variant="yellow">checking</Badge>
  {:else if bridgeStatus.type == "loaded"}
    {#if bridgeStatus.hasFullWritePermissions && bridgeStatus.matrixSpaceId}
      <Badge variant="green">bridged</Badge>
    {:else}
      <Badge>not bridged</Badge>
    {/if}
  {:else if bridgeStatus.type == "pending"}
    <Badge variant="orange">pending</Badge>
  {:else if bridgeStatus.type == "error_checking"}
    <Badge variant="red">error connecting to bridge</Badge>
  {/if}
{/snippet}

<form class="pt-4">
  <div class="space-y-12">
    <h2
      class="text-base/7 font-semibold text-base-900 dark:text-base-100 flex items-center gap-2"
    >
      Matrix Bridge
      {@render bridgeStatusBadge()}
    </h2>

    {#if bridgeStatus.type == "loaded" && bridgeStatus.hasFullWritePermissions && bridgeStatus.matrixSpaceId}
      <p class="text-base/8">
        The Matrix bridge is connected! This Roomy Space is bridge to your <a
          class="text-accent-500 underline underline-offset-3"
          href={`https://matrix.to/#/${bridgeStatus.matrixSpaceId}`}
          target="_blank">Matrix space</a
        >. You can disconnect it by going to Matrix and running the command:
        <code class="bg-base-800 p-1 rounded">!disconnect</code>.
      </p>
    {:else}
      <div class="flex flex-col justify-center gap-8">
        <div class="sm:col-span-4">
          <label
            for="username"
            class="block text-sm/6 font-medium text-base-900 dark:text-base-100"
          >
            <span class="pr-1">
              {bridgeStatus.type == "loaded" ? "✅" : ""}
            </span>
            1. Register the bridge on Matrix</label
          >
          <p class="mt-1 text-sm/6 text-base-600 dark:text-base-400">
            In order to bridge channels, threads, and messages the bridge must
            be registered by running the command:
            <code class="bg-base-800 p-1 rounded"
              >!bridge &lt;matrix-space-id&gt; {page.params.space}</code
            >
          </p>
        </div>

        <div class="sm:col-span-4">
          <label
            for="username"
            class="block text-sm/6 font-medium text-base-900 dark:text-base-100"
          >
            <span class="pr-1">
              {bridgeStatus.type == "loaded"
                ? bridgeStatus.hasFullWritePermissions
                  ? "✅"
                  : ""
                : ""}
            </span>
            2. Grant bot admin access to your Roomy space</label
          >
          <p class="mt-1 text-sm/6 text-base-600 dark:text-base-400">
            In order to bridge channels, threads, and messages the bridge must
            have admin access to your Roomy space.
          </p>

          <div class="mt-4">
            <Button
              disabled={bridgeStatus.type == "loaded"
                ? bridgeStatus.hasFullWritePermissions
                : true}
              onclick={grantBotPermissions}>Grant Access</Button
            >
            <Button
              disabled={bridgeStatus.type == "loaded"
                ? !bridgeStatus.hasFullWritePermissions
                : true}
              onclick={revokeBotPermissions}>Revoke Access</Button
            >
          </div>
        </div>
      </div>
    {/if}
  </div>
</form>
