import { expect, test } from "@playwright/test";
import { TEST_PUBLIC_KEY } from "./freighter-mock";
import {
  MarketplaceTestStore,
  rejectNextE2eTransaction,
  resetE2eListingsInBrowser,
  setupMarketplaceMocks,
} from "./helpers/marketplace-mocks";
import { connectFreighterWallet } from "./helpers/wallet";

const SECOND_BENEFICIARY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

test.describe("Royalties Splitter", () => {
  const store = new MarketplaceTestStore();

  test.beforeEach(async ({ page }) => {
    store.reset();
    await setupMarketplaceMocks(page, store);
    await connectFreighterWallet(page, TEST_PUBLIC_KEY);
    await resetE2eListingsInBrowser(page);
  });

  test("#536: submitting royalties updates the contract split configuration", async ({
    page,
  }) => {
    await page.goto("/dashboard/splitter");
    await expect(
      page.getByRole("heading", { name: "Create Royalty Splitter" }),
    ).toBeVisible({ timeout: 15_000 });

    const addresses = page.getByPlaceholder(/GABC/);
    const percentages = page.locator('input[type="number"]');

    await addresses.first().fill(TEST_PUBLIC_KEY);
    await percentages.first().fill("60");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await addresses.nth(1).fill(SECOND_BENEFICIARY);
    await percentages.nth(1).fill("40");
    await expect(page.getByText("100%", { exact: true })).toBeVisible();

    const deployButton = page.getByRole("button", {
      name: /deploy royalty splitter/i,
    });

    // A rejected Soroban signature prompt must leave the configuration editable.
    await rejectNextE2eTransaction(page);
    await deployButton.click();
    await expect(page.getByText("User declined access")).toBeVisible();
    await expect(addresses.first()).toHaveValue(TEST_PUBLIC_KEY);

    await deployButton.click();

    await expect(
      page.getByRole("heading", { name: "Splitter Deployed" }),
    ).toBeVisible({ timeout: 15_000 });

    const contractAddress = await page
      .locator("code")
      .filter({ hasText: /^CBR/ })
      .textContent();
    expect(contractAddress).toBeTruthy();

    const configuration = await page.evaluate((address) => {
      return (
        window as Window & {
          __E2E_GET_SPLITTER__?: (contractAddress: string) => {
            owner: string;
            recipients: Array<{ address: string; percentage: number }>;
          };
        }
      ).__E2E_GET_SPLITTER__?.(address!);
    }, contractAddress);

    expect(configuration).toEqual({
      owner: TEST_PUBLIC_KEY,
      recipients: [
        { address: TEST_PUBLIC_KEY, percentage: 60 },
        { address: SECOND_BENEFICIARY, percentage: 40 },
      ],
    });
  });

  test("#537: adding a recipient calculates an initial even split", async ({
    page,
  }) => {
    await page.goto("/dashboard/splitter");
    await expect(
      page.getByRole("heading", { name: "Create Royalty Splitter" }),
    ).toBeVisible({ timeout: 15_000 });

    const percentages = page.locator('input[type="number"]');
    const addButton = page.getByRole("button", { name: "Add", exact: true });

    const expectShares = async (shares: string[]) => {
      await expect(percentages).toHaveCount(shares.length);
      for (let i = 0; i < shares.length; i++) {
        await expect(percentages.nth(i)).toHaveValue(shares[i]);
      }
    };

    // A single recipient owns the whole split.
    await expectShares(["100"]);

    // Two recipients split evenly, 50/50.
    await addButton.click();
    await expectShares(["50", "50"]);

    // Three recipients: the indivisible remainder is handed to the first row.
    await addButton.click();
    await expectShares(["34", "33", "33"]);

    // Four recipients split cleanly, 25 each, still summing to 100%.
    await addButton.click();
    await expectShares(["25", "25", "25", "25"]);
    await expect(page.getByText("100%", { exact: true })).toBeVisible();

    // Once the user edits a percentage, auto-split yields: the custom value is
    // preserved and a further "Add" appends a blank row instead of re-splitting.
    await percentages.first().fill("40");
    await addButton.click();
    await expect(percentages).toHaveCount(5);
    await expect(percentages.first()).toHaveValue("40");
    await expect(percentages.nth(4)).toHaveValue("");
  });
});
