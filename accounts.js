(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const style = document.createElement("style");
  style.textContent = `
    #accountForm[hidden],
    #profilePanel[hidden] {
      display: none !important;
    }

    #account .account-settings {
      margin-top: 10px;
    }

    #account .account-settings summary {
      color: #facc15;
    }

    #account .account-settings .compare-actions {
      justify-content: flex-start;
      margin-top: 12px;
    }

    .favorite-star {
      color: #facc15;
      margin-right: 5px;
    }
  `;
  document.head.append(style);

  $("profilePanel").innerHTML = `
    <details class="account-settings" id="accountSettings">
      <summary>Account settings</summary>

      <div style="margin-top:12px">
        <label class="compare-label" for="displayName">
          Display name
        </label>

        <input
          id="displayName"
          class="compare-input"
          type="text"
          maxlength="40"
          autocomplete="nickname"
        >

        <div class="compare-actions">
          <button
            id="saveProfileBtn"
            class="compare-btn"
            type="button"
          >Save name</button>

          <button
            id="signOutBtn"
            class="compare-btn"
            type="button"
          >Sign out</button>
        </div>
      </div>
    </details>
  `;

  const favoriteButton = document.createElement("button");
  favoriteButton.id = "modalFavoriteBtn";
  favoriteButton.type = "button";
  favoriteButton.className = "compare-btn";
  favoriteButton.style.marginTop = "16px";

  const favoriteFeedback = document.createElement("p");
  favoriteFeedback.className = "meta";
  favoriteFeedback.setAttribute("role", "status");

  document.querySelector("#teamModal .team-card")?.append(
    favoriteButton,
    favoriteFeedback
  );

  function message(text) {
    $("accountFeedback").textContent = text;
    favoriteFeedback.textContent = text;
  }

  const config = window.SALAS64_CONFIG;

  if (!config || !window.supabase) {
    message("Account connection could not load. Refresh the page.");
    return;
  }

  let client;

  try {
    client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey
    );
  } catch {
    message("Account connection settings are invalid.");
    return;
  }

  window.salas64Client = client;

  let user = null;
  let profile = null;
  let teams = [];
  let busy = false;
  let starting = true;
  let version = 0;

  function controls() {
    $("accountForm").hidden = Boolean(user);
    $("profilePanel").hidden = !user;

    $("accountStatus").textContent = starting
      ? "Connecting…"
      : user
        ? "Signed in"
        : "Signed out";

    if ($("signedInEmail")) {
      $("signedInEmail").textContent = "";
    }

    $("accountTitle").textContent = user
      ? "My Account"
      : "My Salas 64 Account";

    const subtitle = document.querySelector("#account .subtitle");

    if (subtitle) {
      subtitle.textContent = user
        ? "Open a team card to add or remove a favorite. Favorites have a gold star in the rankings."
        : "Sign in to save your favorite teams across devices.";
    }

    if (user && profile?.display_name) {
      $("accountStatus").textContent =
        `Signed in · ${profile.display_name}`;
    }

    $("signInBtn").disabled = busy || starting;
    $("signUpBtn").disabled = busy || starting;
    $("saveProfileBtn").disabled = busy || !profile;
    $("displayName").disabled = busy || !profile;
    $("signOutBtn").disabled = busy;
  }

  function teamId(team) {
    return String(
      team.teamId ||
      team.espnId ||
      team.logo?.match(/\/([0-9]+)\.(?:png|svg)/)?.[1] ||
      `name:${team.team}`
    );
  }

  function modalTeam() {
    const name = $("modalTeamName")?.textContent;
    return teams.find(team => team.team === name);
  }

  function renderFavorites() {
    const selected = new Set(
      user && profile ? profile.favorite_team_ids || [] : []
    );

    const byName = new Map(
      teams.map(team => [team.team.toLowerCase(), team])
    );

    document.querySelectorAll("#rankingsList .ranking-row")
      .forEach(row => {
        const name = row.querySelector(".team-name");

        if (!name) return;

        name.querySelector(".favorite-star")?.remove();

        const team = byName.get(row.dataset.team);

        if (team && selected.has(teamId(team))) {
          const star = document.createElement("span");
          star.className = "favorite-star";
          star.textContent = "★";
          star.setAttribute("aria-label", "Favorite team");
          star.title = "Your favorite team";
          name.prepend(star);
        }
      });

    const team = modalTeam();
    const followed = Boolean(
      team && selected.has(teamId(team))
    );

    favoriteButton.hidden = !team;
    favoriteButton.disabled =
      busy || starting || Boolean(user && !profile);

    favoriteButton.setAttribute(
      "aria-pressed",
      String(followed)
    );

    favoriteButton.textContent = !user
      ? "☆ Sign in to favorite"
      : followed
        ? "★ Remove favorite"
        : "☆ Add favorite";
  }

  favoriteButton.onclick = () => {
    if (!user) {
      if (typeof closeTeamCard === "function") {
        closeTeamCard();
      }

      $("account").scrollIntoView({ behavior: "smooth" });
      $("authEmail").focus({ preventScroll: true });
      message("Sign in to save favorite teams.");
      return;
    }

    const team = modalTeam();

    if (team) {
      toggleTeam(teamId(team), team.team);
    }
  };

  const rankingsObserver = new MutationObserver(
    renderFavorites
  );

  if ($("rankingsList")) {
    rankingsObserver.observe($("rankingsList"), {
      childList: true
    });
  }

  const modalObserver = new MutationObserver(() => {
    favoriteFeedback.textContent = "";
    renderFavorites();
  });

  if ($("modalTeamName")) {
    modalObserver.observe($("modalTeamName"), {
      childList: true
    });
  }

  async function syncSession(session) {
    const next = session?.user || null;

    if (!starting && next?.id === user?.id && profile) {
      return;
    }

    const ticket = ++version;

    user = next;
    profile = null;
    starting = false;

    $("displayName").value = "";
    $("accountSettings").open = false;

    if (user) {
      $("authEmail").value = "";
      $("authPassword").value = "";
    }

    renderFavorites();
    controls();
    message("");

    window.dispatchEvent(new CustomEvent("salas64:auth", {
      detail: { userId: user?.id || null }
    }));

    if (!user) return;

    const id = user.id;
    message("Loading your profile…");

    try {
      let result = await client
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (result.error) throw result.error;

      if (!result.data) {
        const created = await client
          .from("profiles")
          .upsert(
            { id },
            { onConflict: "id", ignoreDuplicates: true }
          );

        if (created.error) throw created.error;

        result = await client
          .from("profiles")
          .select("*")
          .eq("id", id)
          .single();

        if (result.error) throw result.error;
      }

      if (ticket !== version) return;

      profile = result.data;
      $("displayName").value = profile.display_name || "";

      message("");
      controls();
      renderFavorites();
    } catch (error) {
      if (ticket !== version) return;

      message(`Profile could not load: ${error.message}`);
      controls();
    }
  }

  async function save(fields, success) {
    if (!user || !profile || busy) return;

    const id = user.id;
    const ticket = version;

    busy = true;
    controls();
    renderFavorites();
    message("Saving…");

    try {
      const { data, error } = await client
        .from("profiles")
        .update(fields)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      if (ticket !== version) return;

      profile = data;
      message(success);
    } catch (error) {
      if (ticket === version) {
        message(`Could not save: ${error.message}`);
      }
    } finally {
      busy = false;
      controls();
      renderFavorites();
    }
  }

  function toggleTeam(id, name) {
    const selected = new Set(profile?.favorite_team_ids || []);
    const removing = selected.has(id);

    if (removing) selected.delete(id);
    else selected.add(id);

    return save(
      { favorite_team_ids: [...selected] },
      removing
        ? `Removed ${name} from favorites.`
        : `Added ${name} to favorites.`
    );
  }

  $("saveProfileBtn").onclick = () => save(
    {
      display_name: $("displayName").value.trim().slice(0, 40)
    },
    "Display name saved."
  );

  $("accountForm").onsubmit = async event => {
    event.preventDefault();

    if (busy || starting) return;

    busy = true;
    controls();
    message("Connecting…");

    const credentials = {
      email: $("authEmail").value.trim(),
      password: $("authPassword").value
    };

    try {
      const signup = event.submitter?.id === "signUpBtn";

      const { data, error } = signup
        ? await client.auth.signUp({
            ...credentials,
            options: {
              emailRedirectTo: "https://salas64rankings.com/"
            }
          })
        : await client.auth.signInWithPassword(credentials);

      if (error) throw error;

      $("authEmail").value = "";
      $("authPassword").value = "";

      if (data.session) {
        await syncSession(data.session);
      } else {
        message(
          "Check your email for a confirmation link, then sign in."
        );
      }
    } catch (error) {
      message(error.message || "Sign-in failed. Please try again.");
    } finally {
      busy = false;
      controls();
      renderFavorites();
    }
  };

  $("signOutBtn").onclick = async () => {
    if (busy) return;

    busy = true;
    controls();

    try {
      const { error } = await client.auth.signOut({
        scope: "local"
      });

      if (error) throw error;

      await syncSession(null);
      message("Signed out.");

      $("authEmail").value = "";
      $("authPassword").value = "";
    } catch (error) {
      message(error.message);
    } finally {
      busy = false;
      controls();
      renderFavorites();
    }
  };

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => syncSession(session), 0);
  });

  controls();

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return syncSession(data.session);
    })
    .catch(error => {
      starting = false;
      controls();
      message(error.message);
    });

  fetch(`data/current.json?v=${Date.now()}`, {
    cache: "no-store"
  })
    .then(response => {
      if (!response.ok) throw Error("Team data unavailable");
      return response.json();
    })
    .then(data => {
      teams = (data.rankings || []).filter(
        team => typeof team.team === "string"
      );

      renderFavorites();
    })
    .catch(() => {
      teams = [];
      renderFavorites();
    });
})();
