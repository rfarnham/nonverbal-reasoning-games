import assert from "node:assert/strict";
import test from "node:test";

import { ADAPTIVE_SUBTRACTION_STORAGE_KEY } from "../app/lab/subtraction-flash/adaptive-storage.ts";
import { ARITHMETIC_FLUENCY_STORAGE_KEY } from "../lib/arithmetic-fluency/storage.ts";
import {
  BORROW_FLASH_DEFAULT_PROFILE_ID,
  BORROW_FLASH_MAX_PROFILES,
  BORROW_FLASH_PROFILE_SCHEMA_VERSION,
  BORROW_FLASH_PROFILE_STORAGE_KEY,
  clearBorrowFlashProfileData,
  createBorrowFlashProfile,
  createBorrowFlashProfileStorage,
  loadBorrowFlashProfilesDiagnostic,
  renameBorrowFlashProfile,
  setActiveBorrowFlashProfile,
} from "../app/lab/subtraction-flash/borrow-flash-profiles.ts";
import {
  PERFORMANCE_LEGACY_STORAGE_KEY,
  PERFORMANCE_STORAGE_KEY,
} from "../app/lab/subtraction-flash/performance-storage.ts";

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("an empty device exposes the legacy profile without moving existing data", () => {
  const storage = new MemoryStorage();
  storage.setItem(PERFORMANCE_LEGACY_STORAGE_KEY, "legacy-performance");
  storage.setItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY, "legacy-adaptive");

  const diagnostic = loadBorrowFlashProfilesDiagnostic(storage);
  assert.deepEqual(
    {
      status: diagnostic.status,
      schemaVersion: diagnostic.registry.schemaVersion,
      activeProfileId: diagnostic.registry.activeProfileId,
      profileIds: diagnostic.registry.profiles.map(({ id }) => id),
      canWrite: diagnostic.canWrite,
    },
    {
      status: "empty",
      schemaVersion: BORROW_FLASH_PROFILE_SCHEMA_VERSION,
      activeProfileId: BORROW_FLASH_DEFAULT_PROFILE_ID,
      profileIds: [BORROW_FLASH_DEFAULT_PROFILE_ID],
      canWrite: true,
    },
  );
  assert.equal(storage.getItem(BORROW_FLASH_PROFILE_STORAGE_KEY), null);

  const legacyProfileStorage = createBorrowFlashProfileStorage(
    BORROW_FLASH_DEFAULT_PROFILE_ID,
    storage,
  );
  assert.equal(
    legacyProfileStorage?.getItem(PERFORMANCE_LEGACY_STORAGE_KEY),
    "legacy-performance",
  );
  assert.equal(
    legacyProfileStorage?.getItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY),
    "legacy-adaptive",
  );
  legacyProfileStorage?.setItem("arbitrary-child-key", "unchanged-name");
  assert.equal(storage.getItem("arbitrary-child-key"), "unchanged-name");
});

test("created profiles are activated and isolate every child storage key", () => {
  const storage = new MemoryStorage();
  const first = createBorrowFlashProfile("  Ada   Lovelace  ", storage);
  assert.equal(first.ok, true);
  assert.equal(first.status, "created");
  assert.equal(first.profile?.name, "Ada Lovelace");
  assert.equal(first.registry.activeProfileId, first.profile?.id);

  const second = createBorrowFlashProfile("Grace", storage);
  assert.equal(second.ok, true);
  assert.notEqual(second.profile?.id, first.profile?.id);

  const defaultStorage = createBorrowFlashProfileStorage(
    BORROW_FLASH_DEFAULT_PROFILE_ID,
    storage,
  );
  const firstStorage = createBorrowFlashProfileStorage(first.profile.id, storage);
  const secondStorage = createBorrowFlashProfileStorage(second.profile.id, storage);
  for (const [adapter, value] of [
    [defaultStorage, "default"],
    [firstStorage, "ada"],
    [secondStorage, "grace"],
  ]) {
    adapter.setItem(PERFORMANCE_STORAGE_KEY, value);
    adapter.setItem("any-key", `${value}-anything`);
  }

  assert.equal(defaultStorage.getItem(PERFORMANCE_STORAGE_KEY), "default");
  assert.equal(firstStorage.getItem(PERFORMANCE_STORAGE_KEY), "ada");
  assert.equal(secondStorage.getItem(PERFORMANCE_STORAGE_KEY), "grace");
  assert.equal(defaultStorage.getItem("any-key"), "default-anything");
  assert.equal(firstStorage.getItem("any-key"), "ada-anything");
  assert.equal(secondStorage.getItem("any-key"), "grace-anything");
});

test("switch and rename persist identity without changing profile data", () => {
  const storage = new MemoryStorage();
  const created = createBorrowFlashProfile("Sam", storage);
  const profileId = created.profile.id;
  const profileStorage = createBorrowFlashProfileStorage(profileId, storage);
  profileStorage.setItem(PERFORMANCE_STORAGE_KEY, "sam-data");

  const switched = setActiveBorrowFlashProfile(
    BORROW_FLASH_DEFAULT_PROFILE_ID,
    storage,
  );
  assert.equal(switched.status, "switched");
  assert.equal(switched.registry.activeProfileId, BORROW_FLASH_DEFAULT_PROFILE_ID);

  const renamed = renameBorrowFlashProfile(profileId, "  Samantha  ", storage);
  assert.equal(renamed.status, "renamed");
  assert.equal(renamed.profile?.name, "Samantha");
  assert.equal(
    renamed.registry.activeProfileId,
    BORROW_FLASH_DEFAULT_PROFILE_ID,
    "renaming an idle profile does not switch players",
  );
  assert.equal(profileStorage.getItem(PERFORMANCE_STORAGE_KEY), "sam-data");

  const reloaded = loadBorrowFlashProfilesDiagnostic(storage);
  assert.equal(reloaded.status, "loaded");
  assert.equal(
    reloaded.registry.profiles.find(({ id }) => id === profileId)?.name,
    "Samantha",
  );
  assert.equal(renameBorrowFlashProfile(profileId, "Player 1", storage).status, "duplicate-name");
  assert.equal(renameBorrowFlashProfile(profileId, " ".repeat(30), storage).status, "invalid-name");
  assert.equal(setActiveBorrowFlashProfile("profile-does-not-exist", storage).status, "not-found");
});

test("the profile limit is bounded", () => {
  const storage = new MemoryStorage();
  for (let index = 2; index <= BORROW_FLASH_MAX_PROFILES; index += 1) {
    assert.equal(createBorrowFlashProfile(`Player ${index}`, storage).ok, true);
  }
  const overLimit = createBorrowFlashProfile("One too many", storage);
  assert.equal(overLimit.ok, false);
  assert.equal(overLimit.status, "limit-reached");
  assert.equal(overLimit.registry.profiles.length, BORROW_FLASH_MAX_PROFILES);
});

test("clear removes only that profile's Flash and adaptive data", () => {
  const storage = new MemoryStorage();
  const ada = createBorrowFlashProfile("Ada", storage).profile;
  const grace = createBorrowFlashProfile("Grace", storage).profile;
  const adaStorage = createBorrowFlashProfileStorage(ada.id, storage);
  const graceStorage = createBorrowFlashProfileStorage(grace.id, storage);
  const defaultStorage = createBorrowFlashProfileStorage(
    BORROW_FLASH_DEFAULT_PROFILE_ID,
    storage,
  );
  for (const [adapter, label] of [
    [defaultStorage, "default"],
    [adaStorage, "ada"],
    [graceStorage, "grace"],
  ]) {
    adapter.setItem(PERFORMANCE_STORAGE_KEY, `${label}-v2`);
    adapter.setItem(PERFORMANCE_LEGACY_STORAGE_KEY, `${label}-v1`);
    adapter.setItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY, `${label}-adaptive`);
    adapter.setItem(ARITHMETIC_FLUENCY_STORAGE_KEY, `${label}-curriculum`);
    adapter.setItem("unrelated", `${label}-keep`);
  }

  const cleared = clearBorrowFlashProfileData(ada.id, storage);
  assert.equal(cleared.ok, true);
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.registry.activeProfileId, grace.id);
  assert.equal(cleared.registry.profiles.some(({ id }) => id === ada.id), true);
  assert.equal(adaStorage.getItem(PERFORMANCE_STORAGE_KEY), null);
  assert.equal(adaStorage.getItem(PERFORMANCE_LEGACY_STORAGE_KEY), null);
  assert.equal(adaStorage.getItem(ADAPTIVE_SUBTRACTION_STORAGE_KEY), null);
  assert.equal(adaStorage.getItem(ARITHMETIC_FLUENCY_STORAGE_KEY), null);
  assert.equal(adaStorage.getItem("unrelated"), "ada-keep");
  assert.equal(graceStorage.getItem(PERFORMANCE_STORAGE_KEY), "grace-v2");
  assert.equal(
    graceStorage.getItem(ARITHMETIC_FLUENCY_STORAGE_KEY),
    "grace-curriculum",
  );
  assert.equal(defaultStorage.getItem(PERFORMANCE_STORAGE_KEY), "default-v2");
});

test("corrupt, future, blocked, and failed storage is never overwritten", () => {
  for (const [raw, expectedStatus] of [
    ["{not json", "corrupt"],
    [JSON.stringify({ schemaVersion: 999, activeProfileId: "default", profiles: [] }), "unsupported"],
  ]) {
    const storage = new MemoryStorage();
    storage.setItem(BORROW_FLASH_PROFILE_STORAGE_KEY, raw);
    const diagnostic = loadBorrowFlashProfilesDiagnostic(storage);
    assert.equal(diagnostic.status, expectedStatus);
    assert.equal(diagnostic.canWrite, false);
    assert.equal(createBorrowFlashProfile("Ada", storage).status, expectedStatus);
    assert.equal(clearBorrowFlashProfileData(BORROW_FLASH_DEFAULT_PROFILE_ID, storage).status, expectedStatus);
    assert.equal(storage.getItem(BORROW_FLASH_PROFILE_STORAGE_KEY), raw);
  }

  const blocked = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); },
  };
  assert.equal(loadBorrowFlashProfilesDiagnostic(blocked).status, "unavailable");
  assert.equal(createBorrowFlashProfile("Ada", blocked).status, "unavailable");
  assert.equal(createBorrowFlashProfileStorage("not a profile", blocked), null);
  assert.equal(loadBorrowFlashProfilesDiagnostic(null).status, "unavailable");

  const writeBlocked = new MemoryStorage();
  writeBlocked.setItem = () => { throw new Error("quota"); };
  assert.equal(createBorrowFlashProfile("Ada", writeBlocked).status, "write-failed");
});
