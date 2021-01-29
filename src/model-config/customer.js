"use strict";

import {
  customerFactory,
  customerMixins,
  okToDelete,
} from "../models/customer";
import { validateModel } from "../models/mixins";
import { uuid } from "../lib/utils";

/**
 * @type {import('../models/index').ModelSpecification}
 */
export const Customer = {
  modelName: "customer",
  endpoint: "customers",
  dependencies: { uuid },
  factory: customerFactory,
  validate: validateModel,
  onDelete: okToDelete,
  mixins: customerMixins,
  relations: {
    orders: {
      modelName: "order",
      type: "oneToMany",
      foreignKey: "customerId",
    },
  },
  accessControlList: {
    customer: {
      allow: "read",
      type: "relation",
      desc: "Allow orders to see customers via  `customer` relation.",
    },
  },
};
