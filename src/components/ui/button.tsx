import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button: React.FC<ButtonProps> = ({ className = "", ...props }) => (
  <button className={`inline-flex items-center justify-center rounded-md px-4 py-2 font-medium ${className}`} {...props} />
);
