import { createRouter, createWebHistory } from "vue-router";

import AppOptions from "./AppOptions.vue";
import AppProviderTypes from "./AppProviderTypes.vue";
import Privacy from "./Privacy.vue";

const routes = [
    { path: "/", component: AppOptions },
    { path: "/provider-types", component: AppProviderTypes },
    { path: "/privacy", component: Privacy }
]

const router = createRouter({
    history: createWebHistory(),
    routes
})

export default router
